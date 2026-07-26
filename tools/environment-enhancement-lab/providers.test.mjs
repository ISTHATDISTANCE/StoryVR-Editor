import assert from "node:assert/strict";

import { searchEnvironmentCandidates } from "./lib/providers.mjs";

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

const sketchfabUid = "eb5f5bdc58714e098e3d3ca12c15eb32";

const polyModel = {
  type: 2,
  name: "Living Room Chair",
  description: "A chair for a furnished room.",
  tags: ["chair", "room", "furniture"],
  categories: ["furniture", "seating"],
  authors: { "Poly Artist": "All" },
  polycount: 5626,
  download_count: 400,
  thumbnail_url: "https://cdn.polyhaven.com/chair.png",
};

const polyHdri = {
  type: 0,
  name: "Home Interior",
  description: "Indoor room lighting.",
  tags: ["room", "indoor"],
  categories: ["interior"],
  authors: { "HDR Artist": "All" },
  download_count: 900,
  thumbnail_url: "https://cdn.polyhaven.com/home.png",
};

const ambientRoom = {
  id: "Room001",
  type: "hdri",
  title: "Living Room HDRI",
  shortDescription: "A furnished room.",
  longDescription: "",
  url: "https://ambientcg.com/a/Room001",
  tags: ["living", "room", "furniture"],
  technique: "hdri-bracketed-panorama",
  downloads: [
    { attributes: "1K", extension: "zip", url: "https://ambientcg.com/get?file=Room001_1K.zip", size: 1_000 },
    { attributes: "2K", extension: "zip", url: "https://ambientcg.com/get?file=Room001_2K.zip", size: 2_000 },
  ],
  thumbnails: { "512-WEBP": "https://ambientcg.example/room.webp" },
};

const ambientObjModel = {
  id: "3DChair001",
  type: "3d-model",
  title: "3D Room Chair",
  shortDescription: "A chair model for a room.",
  url: "https://ambientcg.com/a/3DChair001",
  tags: ["chair", "room"],
  technique: "model-photogrammetry",
  downloads: [
    { attributes: "LQ-1K-JPG", extension: "zip", url: "https://ambientcg.com/get?file=3DChair001_LQ-1K-JPG.zip", size: 3_000 },
  ],
  thumbnails: { "512-WEBP": "https://ambientcg.example/chair.webp" },
};

const sketchfabRoom = {
  uid: sketchfabUid,
  name: "Furnished Living Room",
  description: "A complete room scene.",
  isDownloadable: true,
  viewerUrl: `https://sketchfab.com/3d-models/room-${sketchfabUid}`,
  tags: [{ name: "room" }, { name: "interior" }, { name: "noai" }],
  categories: [{ name: "architecture" }],
  thumbnails: { images: [{ width: 720, url: "https://media.sketchfab.com/room.jpeg" }] },
  user: { displayName: "Scene Artist", username: "sceneartist", profileUrl: "https://sketchfab.com/sceneartist" },
  archives: { gltf: { size: 12_345, faceCount: 3000, vertexCount: 2000 } },
  license: "by",
  likeCount: 20,
};

{
  const calls = [];
  const fetchImpl = async (request) => {
    const url = new URL(String(request));
    calls.push(url);
    if (url.hostname === "api.polyhaven.com" && url.searchParams.get("type") === "models") {
      return response({ ArmChair_01: polyModel });
    }
    if (url.hostname === "api.polyhaven.com" && url.searchParams.get("type") === "hdris") {
      return response({ home_interior: polyHdri });
    }
    if (url.hostname === "ambientcg.com") return response({ assets: [ambientRoom] });
    if (url.hostname === "api.sketchfab.com" && url.pathname === "/v3/search") return response({ results: [sketchfabRoom] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await searchEnvironmentCandidates({ query: "furnished living room", fetchImpl });
  assert.deepEqual(Object.keys(result.providerStatus), ["polyhaven", "ambientcg", "sketchfab"]);
  assert.equal(result.providerStatus.polyhaven.status, "ok");
  assert.equal(result.providerStatus.ambientcg.status, "ok");
  assert.equal(result.providerStatus.sketchfab.status, "ok");
  assert.ok(result.candidates.some((candidate) => candidate.id === "polyhaven:ArmChair_01"));
  assert.ok(result.candidates.some((candidate) => candidate.id === "ambientcg:Room001"));
  assert.ok(result.candidates.some((candidate) => candidate.id === `sketchfab:${sketchfabUid}`));
  for (const candidate of result.candidates) {
    assert.equal(candidate.id, `${candidate.provider}:${candidate.sourceId}`);
    assert.deepEqual(Object.keys(candidate.metrics), ["triangles", "vertices", "downloadBytes", "textureBytes"]);
    assert.equal(typeof candidate.humanCreated, "boolean");
    assert.ok(["scene", "model", "hdri", "material", "terrain"].includes(candidate.assetType));
    assert.equal(candidate.metrics.textureBytes, null, "unknown metrics remain null instead of looking like measured zeroes");
    assert.match(candidate.sourceUrl, /^https:\/\//, "every result links to its original asset page");
  }
  assert.equal(result.candidates.find((candidate) => candidate.provider === "ambientcg").metrics.downloadBytes, 2_000, "2K HDRI is preferred");
  const normalizedSketchfab = result.candidates.find((candidate) => candidate.provider === "sketchfab");
  assert.equal(normalizedSketchfab.license.name, "CC BY 4.0");
  assert.equal(normalizedSketchfab.formatLabel, "glTF archive", "format media metadata remains normalized");
  assert.equal(normalizedSketchfab.previewUrl, "https://media.sketchfab.com/room.jpeg", "preview media remains normalized");
  assert.ok(calls.filter((url) => url.hostname === "ambientcg.com").length >= 1, "ambientCG is searched through v3");
}

{
  const fetchImpl = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "ambientcg.com") throw new Error("ambientCG offline");
    if (url.hostname === "api.polyhaven.com") {
      return response(url.searchParams.get("type") === "models" ? { ArmChair_01: polyModel } : {});
    }
    if (url.hostname === "api.sketchfab.com") return response({ results: [sketchfabRoom] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await searchEnvironmentCandidates({ query: "room", fetchImpl });
  assert.equal(result.providerStatus.ambientcg.status, "error");
  assert.equal(result.providerStatus.polyhaven.status, "ok");
  assert.equal(result.providerStatus.sketchfab.status, "ok");
  assert.ok(result.candidates.length >= 2, "one failed provider does not discard other results");
}

{
  const fetchImpl = async () => response({ assets: [ambientObjModel] });
  const search = await searchEnvironmentCandidates({ query: "room chair", providers: ["ambientcg"], fetchImpl });
  assert.equal(search.candidates[0].sourceUrl, "https://ambientcg.com/a/3DChair001");
  assert.equal(search.candidates[0].formatLabel, "3D asset · LQ-1K-JPG · ZIP");
}

console.log("environment enhancement provider adapter checks passed");
