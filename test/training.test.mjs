// The training tools against the fake API: the datasets listing and one by id, an upload that creates the dataset
// first (images, a caption, an archive, a URL — all as parts), the training routed to the plain or the advanced
// operation per model and checked by its schema, the models listing with its query, a 404 said with its meaning.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startFakeApi, testContext, tool, PNG } from "./support/fake-api.mjs";

const dir = await mkdtemp(join(tmpdir(), "ideogram-training-"));
after(() => rm(dir, { recursive: true, force: true }));
const png = join(dir, "a.png"); await writeFile(png, PNG);
const caption = join(dir, "a.txt"); await writeFile(caption, "a red door, flat illustration");
const zip = join(dir, "more.zip"); await writeFile(zip, Buffer.from("504b0506" + "00".repeat(18), "hex"));
const ttf = join(dir, "f.ttf"); await writeFile(ttf, Buffer.from("00010000", "hex"));

async function call(name, args, handler) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, join(dir, `out-${Math.random().toString(16).slice(2)}`));
    const withBase = JSON.parse(JSON.stringify(args).replaceAll("__BASE__", api.base));
    const result = await (await tool(name)).handler(ctx, withBase);
    return { result, requests: api.requests };
  } finally {
    await api.close();
  }
}
const text = (r) => r.content.map((c) => c.text).join("\n");
const dataset = { dataset_id: "ds1", name: "brand refs", creation_time: "2026-10-10T00:00:00Z", user_id: "u1", cover_asset_identifier: null };

test("ideogram_datasets lists (with a search) and shows one dataset with its files and models", async () => {
  const list = await call("ideogram_datasets", { search: "brand" }, () => ({ json: { datasets: [dataset] } }));
  assert.equal(list.requests[0].url, "/datasets?search=brand");
  assert.match(text(list.result), /1 dataset\(s\).*\n  brand refs \(ds1\), created 2026-10-10T00:00:00Z/);
  const one = await call("ideogram_datasets", { dataset_id: "ds1" }, () => ({ json: { dataset, file_count: 2, custom_model_ids: ["m1"], files: [{ file_name: "a.png", file_size_bytes: 16, caption: "a red door" }, { file_name: "b.png" }] } }));
  assert.equal(one.requests[0].url, "/datasets/ds1");
  assert.match(text(one.result), /Dataset brand refs \(ds1\): 2 file\(s\), 1 model\(s\) trained from it: m1\.\n  a\.png \(16 bytes\) — a red door\n  b\.png/);
  const gone = await call("ideogram_datasets", { dataset_id: "nope" }, () => ({ status: 404, json: { error: "not found" } }));
  assert.equal(gone.result.isError, true);
  assert.match(text(gone.result), /the dataset is not yours or does not exist \(Ideogram's answer: /);
});

test("ideogram_dataset_upload creates the dataset from a name, then uploads images, a caption, an archive and a URL as parts under one field", async () => {
  const uploaded = { total_count: 4, success_count: 3, failure_count: 1, successful_assets: [{ file_name: "files.png", asset_identifier: { asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" } }, { file_name: "files.txt", asset_identifier: { asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" } }, { file_name: "files.zip", asset_identifier: { asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" } }], failed_assets: [{ file_name: "files.png", failure_reason: "FAILED_SAFETY_CHECK" }] };
  const handler = (req) => {
    if (req.url === "/remote/b.png") return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
    if (req.method === "POST" && req.url === "/datasets") return { json: dataset };
    if (req.method === "POST" && req.url === "/datasets/ds1/upload_assets") return { json: uploaded };
    return { status: 500 };
  };
  const { result, requests } = await call("ideogram_dataset_upload", { name: "brand refs", files: [png, caption, zip, "__BASE__/remote/b.png"] }, handler);
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /remote/b.png", "POST /datasets", "POST /datasets/ds1/upload_assets"], "the URL fetched after the local files, the dataset created, then the upload");
  assert.equal(JSON.parse(requests[1].body.toString()).name, "brand refs");
  const body = requests[2].body.toString("latin1");
  assert.match(body, /name="files"; filename="files.png"\r\nContent-Type: image\/png/);
  assert.match(body, /name="files"; filename="files.txt"\r\nContent-Type: text\/plain/);
  assert.match(body, /name="files"; filename="files.zip"\r\nContent-Type: application\/zip/);
  assert.equal(body.split('name="files"').length - 1, 4);
  assert.match(text(result), /Dataset brand refs created: ds1\.\n3 of 4 asset\(s\) uploaded to dataset ds1, 1 failed:\n  files\.png: FAILED_SAFETY_CHECK/);
  const both = await call("ideogram_dataset_upload", { name: "x", dataset_id: "ds1", files: [png] }, handler);
  assert.match(text(both.result), /give dataset_id .* or name .*, not both/);
  const font = await call("ideogram_dataset_upload", { dataset_id: "ds1", files: [ttf] }, handler).catch((e) => e);
  assert.match(font.message, /files: unsupported file type \.ttf; one of \.png, \.jpg, \.jpeg, \.webp, \.txt, \.zip/);
});

test("ideogram_train routes to the plain operation, or the advanced one when a hyperparameter is given, per model; a field the model's training does not take is refused", async () => {
  const started = { dataset_id: "ds1", model_id: "m2", model_name: "Planet Drip", training_status: "TRAINING" };
  const plain = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip" }, () => ({ json: started }));
  assert.equal(plain.requests[0].url, "/v1/ideogram-v4/train-model");
  assert.deepEqual(JSON.parse(plain.requests[0].body.toString()), { dataset_id: "ds1", model_name: "Planet Drip" });
  assert.match(text(plain.result), /Training started: model Planet Drip \(m2\) from dataset ds1, status TRAINING\.\nFollow it with ideogram_models \{"model_id": "m2"\}/);
  const advanced = await call("ideogram_train", { model: "ideogram-3", dataset_id: "ds1", model_name: "Planet Drip", training_steps: 2000, lora_rank: 64 }, () => ({ json: started }));
  assert.equal(advanced.requests[0].url, "/v1/ideogram-v3/train-model-advanced");
  assert.deepEqual(JSON.parse(advanced.requests[0].body.toString()), { dataset_id: "ds1", model_name: "Planet Drip", training_steps: 2000, lora_rank: 64 });
  const v3batch = await call("ideogram_train", { model: "ideogram-3", dataset_id: "ds1", model_name: "Planet Drip", batch_size: 8 }, () => ({ json: started }));
  assert.match(text(v3batch.result), /batch_size is not a parameter of ideogram-3's training \(train_model_v3_advanced\)/);
  assert.equal(v3batch.requests.length, 0);
  const short = await call("ideogram_train", { dataset_id: "ds1", model_name: "abc" }, () => ({ json: started }));
  assert.match(text(short.result), /model_name/);
  assert.equal(short.requests.length, 0);
});

test("ideogram_models lists with scope and repeated status, and shows one model; a 404 says what it means", async () => {
  const model = { model_id: "m2", name: "Planet Drip", status: "COMPLETED", dataset_id: "ds1", is_owned: true, is_available_for_generation: true, custom_model_uri: "model/planet-drip/version/1", creation_time: "2026-10-10T00:00:00Z", last_update_time: "2026-10-10T01:00:00Z" };
  const list = await call("ideogram_models", { scope: "owned", status: ["TRAINING", "COMPLETED"] }, () => ({ json: { models: [model] } }));
  const q = new URL(list.requests[0].url, "http://x").searchParams;
  assert.deepEqual([q.get("scope"), q.getAll("status")], ["owned", ["TRAINING", "COMPLETED"]]);
  assert.match(text(list.result), /1 custom model\(s\)\.\n  Planet Drip \(m2\): COMPLETED, available for generation · model\/planet-drip\/version\/1/);
  const one = await call("ideogram_models", { model_id: "m2" }, () => ({ json: { model: { ...model, training_runs: [] } } }));
  assert.equal(one.requests[0].url, "/models/m2");
  assert.match(text(one.result), /Training runs: 0/);
  const gone = await call("ideogram_models", { model_id: "nope" }, () => ({ status: 404, json: { error: "no" } }));
  assert.match(text(gone.result), /not yours, not shared with your organization, or does not exist/);
});
