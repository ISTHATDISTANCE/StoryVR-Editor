import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeExplicitPointCloudEffects,
  discoverExplicitPointCloudLinks,
  parseGlbDocument,
  pointCloudDownloadCandidates,
  summarizePcd
} from "./pointcloud-effect.mjs";

function paddedBuffer(buffer, padByte = 0) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, padByte)]) : buffer;
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function transmissionFixtureGlb() {
  const times = floatBuffer([0, 0.5, 1]);
  const driver0 = floatBuffer([
    0, 0, 0,
    0.001, 0, 0,
    0.01, 0, 0
  ]);
  const driver1 = floatBuffer([
    0, 0, 0,
    0, 0, 0,
    0.01, 0, 0
  ]);
  const binary = paddedBuffer(Buffer.concat([times, driver0, driver1]));
  const json = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes: [
      { name: "cough_driver_0" },
      { name: "cough_driver_1" },
      { name: "label_3ft", translation: [0, 0, 0.01] },
      { name: "label_26ft", translation: [0, 0, 0.08] }
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: times.length },
      { buffer: 0, byteOffset: times.length, byteLength: driver0.length },
      { buffer: 0, byteOffset: times.length + driver0.length, byteLength: driver1.length }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" }
    ],
    animations: [{
      name: "Take 001",
      samplers: [
        { input: 0, output: 1, interpolation: "LINEAR" },
        { input: 0, output: 2, interpolation: "LINEAR" }
      ],
      channels: [
        { sampler: 0, target: { node: 0, path: "translation" } },
        { sampler: 1, target: { node: 1, path: "translation" } }
      ]
    }]
  };
  const jsonChunk = paddedBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const output = Buffer.alloc(totalLength);
  output.write("glTF", 0, "utf8");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binary.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

function transmissionFixturePcd() {
  return Buffer.from([
    "# .PCD v.7 - Point Cloud Data file format",
    "VERSION .7",
    "FIELDS x y z rgb",
    "SIZE 4 4 4 4",
    "TYPE F F F F",
    "COUNT 1 1 1 1",
    "WIDTH 2",
    "HEIGHT 1",
    "POINTS 4",
    "DATA ascii",
    "0 0 0 3 0",
    "1 1 1 4 0",
    "2 2 2 5 1",
    "3 3 3 6 1",
    ""
  ].join("\n"), "utf8");
}

function transmissionProbe() {
  return {
    story_url: "https://www.nytimes.com/interactive/transmission.html",
    scripts: [{
      index: 0,
      src: null,
      text: [
        "var NYTG = NYTG || {};",
        "NYTG.WEBGL_DATA = NYTG.WEBGL_DATA || [];",
        "NYTG.WEBGL_DATA.push({\"models\":[{\"src\":\"models/transmission.glb\",\"transform\":{\"scale\":\"100, 100, 100\"},\"ptcloud\":\"pcd/cloud.pcd\"}],\"slides\":[]});"
      ].join("\n")
    }],
    resource_entries: [{
      url: "https://cdn.example.com/story/cloud.pcd",
      assetType: "other",
      candidate: false,
      initiatorType: "xmlhttprequest"
    }]
  };
}

test("explicit ptcloud source config activates the optional point-cloud candidate path", () => {
  const probe = transmissionProbe();
  const links = discoverExplicitPointCloudLinks(probe);
  assert.equal(links.length, 1);
  assert.equal(links[0].modelReference, "models/transmission.glb");
  assert.equal(links[0].pointCloudReference, "pcd/cloud.pcd");
  const candidates = pointCloudDownloadCandidates(probe, links);
  assert.deepEqual(candidates.map((candidate) => ({
    url: candidate.url,
    assetType: candidate.assetType,
    resolutionKind: candidate.resolutionKind
  })), [{
    url: "https://cdn.example.com/story/cloud.pcd",
    assetType: "pointcloud",
    resolutionKind: "captured-resource-basename-match"
  }]);
});

test("a standalone PCD request does not create a requirement or candidate", () => {
  const probe = {
    story_url: "https://example.com/ordinary-story",
    resource_entries: [{
      url: "https://example.com/unrelated.pcd",
      assetType: "other",
      candidate: false
    }]
  };
  assert.deepEqual(discoverExplicitPointCloudLinks(probe), []);
  assert.deepEqual(pointCloudDownloadCandidates(probe), []);
  assert.deepEqual(analyzeExplicitPointCloudEffects({ links: [], downloads: [] }), []);
});

test("transmission specialization preserves malformed PCD extras and decodes reveal gates", () => {
  const probe = transmissionProbe();
  const links = discoverExplicitPointCloudLinks(probe);
  const modelBytes = transmissionFixtureGlb();
  const pointCloudBytes = transmissionFixturePcd();
  const pcd = summarizePcd(pointCloudBytes);
  assert.equal(pcd.declaredFields.length, 4);
  assert.equal(pcd.observedColumnCount, 5);
  assert.equal(pcd.columns[4].name, "_extra_1");
  assert.deepEqual(pcd.columns[4].uniqueValues, [0, 1]);
  assert.equal(parseGlbDocument(modelBytes).json.animations[0].name, "Take 001");

  const effects = analyzeExplicitPointCloudEffects({
    links,
    downloads: [
      {
        url: "https://cdn.example.com/story/transmission.glb",
        finalUrl: "https://cdn.example.com/story/transmission.glb",
        assetType: "model",
        localPath: "/tmp/transmission.glb",
        fileSize: modelBytes.length,
        bytes: modelBytes
      },
      {
        url: "https://cdn.example.com/story/cloud.pcd",
        finalUrl: "https://cdn.example.com/story/cloud.pcd",
        assetType: "pointcloud",
        localPath: "/tmp/cloud.pcd",
        fileSize: pointCloudBytes.length,
        bytes: pointCloudBytes
      }
    ],
    sourceEvidence: [{
      id: "evidence-ptcloud",
      context: "models/transmission.glb ptcloud pcd/cloud.pcd"
    }]
  });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].captureStatus, "complete");
  assert.equal(effects[0].scope.requiredForUnrelatedStories, false);
  assert.equal(effects[0].pointCloud.driverGroupColumn.name, "_extra_1");
  assert.deepEqual(effects[0].reconstructionContract.emitTimesSeconds, [
    { groupIndex: 0, emitTimeSeconds: 0.25, driverNode: "cough_driver_0" },
    { groupIndex: 1, emitTimeSeconds: 0.55, driverNode: "cough_driver_1" }
  ]);
  assert.deepEqual(effects[0].alignmentEvidence.distanceMarkers.map((marker) => marker.name), [
    "label_26ft",
    "label_3ft"
  ]);
});
