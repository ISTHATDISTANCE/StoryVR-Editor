import assert from "node:assert/strict";

import { searchEnvironmentCandidates } from "./providers.mjs";

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

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

{
  const calls = [];
  const fetchImpl = async (request) => {
    const url = new URL(String(request));
    calls.push(url);
    if (url.hostname === "api.polyhaven.com" && url.searchParams.get("type") === "hdris") {
      return response({ home_interior: polyHdri });
    }
    if (url.hostname === "ambientcg.com") return response({ assets: [ambientRoom, ambientObjModel] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await searchEnvironmentCandidates({ query: "furnished living room", fetchImpl });
  assert.deepEqual(Object.keys(result.providerStatus), ["polyhaven", "ambientcg"]);
  assert.equal(result.providerStatus.polyhaven.status, "ok");
  assert.equal(result.providerStatus.ambientcg.status, "ok");
  assert.ok(result.candidates.some((candidate) => candidate.id === "polyhaven:home_interior"));
  assert.ok(result.candidates.some((candidate) => candidate.id === "ambientcg:Room001"));
  assert.equal(result.candidates.some((candidate) => candidate.id === "ambientcg:3DChair001"), false);
  for (const candidate of result.candidates) {
    assert.equal(candidate.id, `${candidate.provider}:${candidate.sourceId}`);
    assert.deepEqual(Object.keys(candidate.metrics), ["triangles", "vertices", "downloadBytes", "textureBytes"]);
    assert.equal(typeof candidate.humanCreated, "boolean");
    assert.equal(candidate.assetType, "hdri");
    assert.equal(candidate.projection, "equirectangular");
    assert.equal(candidate.metrics.textureBytes, null, "unknown metrics remain null instead of looking like measured zeroes");
    assert.match(candidate.sourceUrl, /^https:\/\//, "every result links to its original asset page");
  }
  assert.equal(result.candidates.find((candidate) => candidate.provider === "ambientcg").metrics.downloadBytes, 2_000, "2K HDRI is preferred");
  assert.equal(calls.some((url) => url.searchParams.get("type") === "models"), false, "Poly Haven models are never queried");
  assert.equal(calls.some((url) => url.hostname === "api.sketchfab.com"), false, "3D-model providers are not queried");
  assert.ok(calls.filter((url) => url.hostname === "ambientcg.com").every((url) => url.searchParams.get("type") === "hdri"));
  assert.ok(calls.filter((url) => url.hostname === "ambientcg.com").length >= 1, "ambientCG is searched through v3");
}

{
  const fetchImpl = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "ambientcg.com") throw new Error("ambientCG offline");
    if (url.hostname === "api.polyhaven.com") return response({ home_interior: polyHdri });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await searchEnvironmentCandidates({ query: "room", fetchImpl });
  assert.equal(result.providerStatus.ambientcg.status, "error");
  assert.equal(result.providerStatus.polyhaven.status, "ok");
  assert.equal(result.candidates.length, 1, "one failed provider does not discard another provider's HDRI results");
}

{
  const fetchImpl = async () => response({ assets: [ambientObjModel, ambientRoom] });
  const search = await searchEnvironmentCandidates({ query: "room chair", providers: ["ambientcg"], fetchImpl });
  assert.deepEqual(search.candidates.map((candidate) => candidate.id), ["ambientcg:Room001"]);
  assert.match(search.candidates[0].formatLabel, /^HDRI/);
}

console.log("StoryVR environment provider adapter checks passed");
