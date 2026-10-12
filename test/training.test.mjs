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
const png = join(dir, "a.png");
await writeFile(png, PNG);
const caption = join(dir, "a.txt");
await writeFile(caption, "a red door, flat illustration");
const zip = join(dir, "more.zip");
await writeFile(zip, Buffer.from("504b0506" + "00".repeat(18), "hex"));
const ttf = join(dir, "f.ttf");
await writeFile(ttf, Buffer.from("00010000", "hex"));
await (await import("node:fs/promises")).mkdir(join(dir, "sub"));
await writeFile(join(dir, "sub", "a.png"), PNG);

async function call(name, args, handler, outputDir = join(dir, `out-${Math.random().toString(16).slice(2)}`)) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, outputDir);
    const withBase = JSON.parse(JSON.stringify(args).replaceAll("__BASE__", api.base));
    const result = await (await tool(name)).handler(ctx, withBase);
    return { result, requests: api.requests };
  } finally {
    await api.close();
  }
}
const text = (r) => r.content.map((c) => c.text).join("\n");
const dataset = {
  dataset_id: "ds1",
  name: "brand refs",
  creation_time: "2026-10-10T00:00:00Z",
  user_id: "u1",
  cover_asset_identifier: null,
};

test("ideogram_datasets lists (with a search) and shows one dataset with its files and models", async () => {
  const list = await call("ideogram_datasets", { search: "brand" }, () => ({ json: { datasets: [dataset] } }));
  assert.equal(list.requests[0].url, "/datasets?search=brand");
  assert.match(text(list.result), /1 dataset\(s\).*\n  brand refs \(ds1\), created 2026-10-10T00:00:00Z/);
  const one = await call("ideogram_datasets", { dataset_id: "ds1" }, () => ({
    json: {
      dataset,
      file_count: 2,
      custom_model_ids: ["m1"],
      files: [{ file_name: "a.png", file_size_bytes: 16, caption: "a red door" }, { file_name: "b.png" }],
    },
  }));
  assert.equal(one.requests[0].url, "/datasets/ds1");
  assert.match(
    text(one.result),
    /Dataset brand refs \(ds1\): 2 file\(s\), 1 model\(s\) trained from it: m1\.\n  a\.png \(16 bytes\) — a red door\n  b\.png/,
  );
  const fileDir = join(dir, "listing-not-a-dir");
  await writeFile(fileDir, "x");
  const big = await call(
    "ideogram_datasets",
    {},
    () => ({ json: { datasets: Array(900).fill(dataset) } }),
    join(fileDir, "out"),
  );
  assert.equal(
    big.result.isError,
    true,
    "a listing too large to print whose file could not be written is an error: the data is nowhere the client can read",
  );
  assert.match(
    text(big.result),
    /^900 dataset\(s\)[\s\S]*As Ideogram sent them: not written to .*; too large to print here \(\d+ bytes\)$/,
  );
  const small = await call("ideogram_datasets", {}, () => ({ json: { datasets: [dataset] } }), join(fileDir, "out"));
  assert.equal(
    small.result.isError,
    undefined,
    "a small listing is printed whole: the write failure is said, not an error",
  );
  assert.match(text(small.result), /not written to [\s\S]*"dataset_id": "ds1"/);
  const gone = await call("ideogram_datasets", { dataset_id: "nope" }, () => ({
    status: 404,
    json: { error: "not found" },
  }));
  assert.equal(gone.result.isError, true);
  assert.match(text(gone.result), /the dataset is not yours or does not exist \(Ideogram's answer: /);
});

test("ideogram_dataset_upload creates the dataset from a name, then uploads images, a caption, an archive and a URL as parts under one field", async () => {
  const asset = { asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" };
  const uploaded = {
    total_count: 4,
    success_count: 3,
    failure_count: 1,
    successful_assets: [
      { file_name: "a.png", asset_identifier: asset },
      { file_name: "a.txt", asset_identifier: asset },
      { file_name: "more.zip", asset_identifier: asset },
    ],
    failed_assets: [{ file_name: "b.png", failure_reason: "FAILED_SAFETY_CHECK" }, { failure_reason: "INVALID_ZIP" }],
  };
  const handler = (req) => {
    if (req.url === "/remote/b.png") return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
    if (req.url === "/remote/c.txt")
      return { status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: "a caption by URL" };
    if (req.url === "/remote/d.zip")
      return {
        status: 200,
        headers: { "content-type": "application/x-zip-compressed" },
        body: Buffer.from("504b0506" + "00".repeat(18), "hex"),
      };
    if (req.method === "POST" && req.url === "/datasets") return { json: dataset };
    if (req.method === "POST" && req.url === "/datasets/ds1/upload_assets") return { json: uploaded };
    return { status: 500 };
  };
  const { result, requests } = await call(
    "ideogram_dataset_upload",
    { name: "brand refs", files: [png, caption, zip, "__BASE__/remote/b.png"] },
    handler,
  );
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    ["GET /remote/b.png", "POST /datasets", "POST /datasets/ds1/upload_assets"],
    "the URL fetched after the local files, the dataset created, then the upload",
  );
  assert.equal(JSON.parse(requests[1].body.toString()).name, "brand refs");
  const body = requests[2].body.toString("latin1");
  assert.match(
    body,
    /name="files"; filename="a.png"\r\nContent-Type: image\/png/,
    "the asset keeps its name: the API pairs a caption by it",
  );
  assert.match(body, /name="files"; filename="a.txt"\r\nContent-Type: text\/plain/);
  assert.match(body, /name="files"; filename="more.zip"\r\nContent-Type: application\/zip/);
  assert.match(
    body,
    /name="files"; filename="b.png"\r\nContent-Type: image\/png/,
    "a URL input is named by its last segment",
  );
  assert.doesNotMatch(body, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "never the directory");
  assert.equal(body.split('name="files"').length - 1, 4);
  assert.match(
    text(result),
    /Dataset brand refs created: ds1\.\n3 of 4 asset\(s\) uploaded to dataset ds1, 1 failed:\n  b\.png: FAILED_SAFETY_CHECK\n  \(unnamed\): INVALID_ZIP/,
  );
  const byUrl = await call(
    "ideogram_dataset_upload",
    { dataset_id: "ds1", files: ["__BASE__/remote/c.txt", "__BASE__/remote/d.zip"] },
    handler,
  );
  const parts = byUrl.requests.find((r) => r.url === "/datasets/ds1/upload_assets").body.toString("latin1");
  assert.match(parts, /filename="c.txt"\r\nContent-Type: text\/plain/, "a caption by URL");
  const spaced = await call(
    "ideogram_dataset_upload",
    { dataset_id: "ds1", files: ["__BASE__/remote/red%20door.png"] },
    (req) =>
      req.url === "/remote/red%20door.png"
        ? { status: 200, headers: { "content-type": "image/png" }, body: PNG }
        : { json: uploaded },
  );
  assert.match(
    spaced.requests.find((r) => r.url === "/datasets/ds1/upload_assets").body.toString("latin1"),
    /filename="red door.png"/,
    "a URL's segment is decoded: the pairing is by the decoded name",
  );
  const smuggled = await call(
    "ideogram_dataset_upload",
    { dataset_id: "ds1", files: ["__BASE__/remote/..%2F..%2Fx.png", "__BASE__/remote/a%5Cb.png"] },
    (req) =>
      req.url.startsWith("/remote/")
        ? { status: 200, headers: { "content-type": "image/png" }, body: PNG }
        : { json: uploaded },
  );
  const smuggledBody = smuggled.requests.find((r) => r.url === "/datasets/ds1/upload_assets").body.toString("latin1");
  assert.match(
    smuggledBody,
    /filename="x.png"/,
    "a decoded slash never names a directory: the last segment is the name",
  );
  assert.match(smuggledBody, /filename="b.png"/, "a decoded backslash likewise");
  assert.doesNotMatch(smuggledBody, /filename="[^"]*[\/\\]/, "no separator leaves the machine in a part name");
  assert.match(
    parts,
    /filename="d.zip"\r\nContent-Type: application\/zip/,
    "a zip by URL under its alias is sent as application/zip",
  );
  const onImage = await call("ideogram_remix", { prompt: "x", image: caption }, handler).catch((e) => e);
  assert.match(
    onImage.message,
    /image: unsupported file type \.txt; one of \.png, \.jpg, \.jpeg, \.webp$/,
    "the dataset types do not leak to an image field",
  );
  const orphan = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, (req) =>
    req.method === "POST" && req.url === "/datasets" ? { json: dataset } : { status: 404, json: { error: "gone" } },
  );
  assert.equal(orphan.result.isError, true);
  assert.match(
    text(orphan.result),
    /^Dataset brand refs created: ds1\.\nNothing was uploaded\. Upload again with dataset_id "ds1", not with name\./,
    "a refused upload after the create names the dataset first: nothing is in",
  );
  const cut = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, (req) =>
    req.method === "POST" && req.url === "/datasets" ? { json: dataset } : { status: 503, json: { error: "down" } },
  );
  assert.match(
    text(cut.result),
    /^Dataset brand refs created: ds1\.\nideogram_dataset_upload: .*503.*\nThe assets MAY be in the dataset: show it \(ideogram_datasets \{"dataset_id": "ds1"\}\) before uploading again/,
    "a 5xx after the create names the dataset and says the assets may be in",
  );
  assert.doesNotMatch(
    text(cut.result),
    /Upload again with dataset_id/,
    "a request that may have gone through is never told to upload again",
  );
  const create504 = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, () => ({
    status: 504,
    json: { error: "late" },
  }));
  assert.match(
    text(create504.result),
    /504[\s\S]*A dataset named "brand refs" MAY have been created: list ideogram_datasets before creating it again/,
    "a 5xx on the create: a dataset may exist",
  );
  const create400 = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, () => ({
    status: 400,
    json: { error: "bad name" },
  }));
  assert.doesNotMatch(text(create400.result), /MAY have been created/, "a refusal made nothing");
  assert.match(text(create400.result), /400/);
  const fileDir = join(dir, "not-a-dir"); // the output directory is a FILE: nothing can be written under it
  await writeFile(fileDir, "x");
  const unwritable = await call(
    "ideogram_dataset_upload",
    { name: "brand refs", files: [png] },
    (req) => (req.method === "POST" && req.url === "/datasets" ? { json: dataset } : { json: uploaded }),
    join(fileDir, "out"),
  );
  assert.match(
    text(unwritable.result),
    /^Dataset brand refs created: ds1\.\n3 of 4 asset\(s\) uploaded to dataset ds1, 1 failed:\n[\s\S]*As Ideogram sent it: not written to .*ENOTDIR[^\n]*\n\{\n  "total_count": 4/,
    "a 200 whose raw answer cannot be written is still the success it was: the id first, the answer shown inline",
  );
  assert.equal(unwritable.result.isError, undefined, "an unwritable disk is not an upload error");
  const offSchema = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, (req) =>
    req.method === "POST" && req.url === "/datasets" ? { json: dataset } : { json: { success_count: "three" } },
  );
  assert.match(
    text(offSchema.result),
    /^Dataset brand refs created: ds1\.\nIdeogram answered 200 with a body that does not match/,
    "a 200 off the schema after the create names the dataset too",
  );
  const createOff = await call("ideogram_dataset_upload", { name: "brand refs", files: [png] }, () => ({
    json: { dataset_id: 7 },
  }));
  assert.match(
    text(createOff.result),
    /A dataset named "brand refs" MAY have been created: list ideogram_datasets before creating it again/,
  );
  const traversal = await call("ideogram_datasets", { dataset_id: "../../escape" }, () => ({
    json: { dataset: { ...dataset, dataset_id: "../../escape" }, file_count: 0, custom_model_ids: [], files: [] },
  }));
  assert.match(
    text(traversal.result),
    /ideogram-dataset-____escape\.json/,
    "a caller's id is a sanitized file-name component",
  );
  const twin = await call(
    "ideogram_dataset_upload",
    { dataset_id: "ds1", files: [png, join(dir, "sub", "a.png")] },
    handler,
  ).catch((e) => e);
  assert.match(twin.message, /two files would be sent as a\.png/);
  const both = await call("ideogram_dataset_upload", { name: "x", dataset_id: "ds1", files: [png] }, handler);
  assert.match(text(both.result), /give dataset_id .* or name .*, not both/);
  const font = await call("ideogram_dataset_upload", { dataset_id: "ds1", files: [ttf] }, handler).catch((e) => e);
  assert.match(
    font.message,
    /files: unsupported file type \.ttf; one of \.png, \.jpg, \.jpeg, \.webp, \.txt, \.json, \.zip/,
  );
});

test("ideogram_train routes to the plain operation, or the advanced one when a hyperparameter is given, per model; a field the model's training does not take is refused", async () => {
  const started = { dataset_id: "ds1", model_id: "m2", model_name: "Planet Drip", training_status: "TRAINING" };
  const plain = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip" }, () => ({
    json: started,
  }));
  assert.equal(plain.requests[0].url, "/v1/ideogram-v4/train-model");
  assert.deepEqual(JSON.parse(plain.requests[0].body.toString()), { dataset_id: "ds1", model_name: "Planet Drip" });
  assert.match(
    text(plain.result),
    /Training started: model Planet Drip \(m2\) from dataset ds1, status TRAINING\.\nFollow it with ideogram_models \{"model_id": "m2"\}/,
  );
  const advanced = await call(
    "ideogram_train",
    { model: "ideogram-3", dataset_id: "ds1", model_name: "Planet Drip", training_steps: 2000, lora_rank: 64 },
    () => ({ json: started }),
  );
  assert.equal(advanced.requests[0].url, "/v1/ideogram-v3/train-model-advanced");
  assert.deepEqual(JSON.parse(advanced.requests[0].body.toString()), {
    dataset_id: "ds1",
    model_name: "Planet Drip",
    training_steps: 2000,
    lora_rank: 64,
  });
  const v3batch = await call(
    "ideogram_train",
    { model: "ideogram-3", dataset_id: "ds1", model_name: "Planet Drip", batch_size: 8 },
    () => ({ json: started }),
  );
  assert.match(
    text(v3batch.result),
    /batch_size is not a parameter of ideogram-3's training \(train_model_v3_advanced\)/,
  );
  assert.equal(v3batch.requests.length, 0);
  const padded = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip\n" }, () => ({
    json: started,
  }));
  assert.match(text(padded.result), /model_name must be 5-30 characters/, "judged as sent, never trimmed");
  const down = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip" }, () => ({
    status: 503,
    json: { error: "down" },
  }));
  assert.match(text(down.result), /a training MAY have started and will be billed/, "a 5xx after the request left");
  const { IdeogramApiError } = await import("../dist/errors.js");
  const api0 = await startFakeApi(() => ({ json: started }));
  try {
    const ctx0 = await testContext(api0.base, join(dir, "out-budget"));
    const client0 = Object.create(ctx0.client);
    client0.call = async () => {
      throw new IdeogramApiError(0, "CALL_TIMEOUT", "the call's time ran out before this request could be made", {
        sent: false,
      });
    };
    const early = await (
      await tool("ideogram_train")
    ).handler({ ...ctx0, client: client0 }, { dataset_id: "ds1", model_name: "Planet Drip" });
    assert.match(
      text(early),
      /^ideogram_train: Ideogram API error CALL_TIMEOUT \(0\): the call's time ran out before this request could be made$/,
      "a budget that ended before the request left started nothing: the typed error alone, no warning",
    );
    client0.call = async () => {
      throw new Error("the request body is 61 MB; upload_dataset_assets takes at most 50 MB");
    };
    const refusedHere = await (
      await tool("ideogram_train")
    ).handler({ ...ctx0, client: client0 }, { dataset_id: "ds1", model_name: "Planet Drip" });
    assert.doesNotMatch(
      text(refusedHere),
      /MAY have started/,
      "a refusal raised on this machine before any request started nothing",
    );
    client0.call = async () => {
      throw new IdeogramApiError(0, "CALL_TIMEOUT", "the call's time ran out; the request was in flight", {
        sent: true,
      });
    };
    const inFlight = await (
      await tool("ideogram_train")
    ).handler({ ...ctx0, client: client0 }, { dataset_id: "ds1", model_name: "Planet Drip" });
    assert.match(text(inFlight), /MAY have started/, "a request that left may have started a billed training");
  } finally {
    await api0.close();
  }
  const refused = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip" }, () => ({
    status: 404,
    json: { error: "no" },
  }));
  assert.match(text(refused.result), /the dataset is not yours, does not exist, or this key cannot train/);
  const rawTrain503 = await call(
    "ideogram_api",
    {
      operation: "train_dataset_model",
      allow_undocumented: true,
      params: { path: { dataset_id: "ds1" }, body: { model_name: "Planet Drip" } },
    },
    () => ({ status: 503, json: { error: "down" } }),
  );
  assert.match(
    text(rawTrain503.result),
    /HTTP_503[\s\S]*The request had left this machine: train_dataset_model MAY have run and be billed — check before sending it again/,
    "ideogram_api says what the training tools say: a 5xx on a call with a side effect may have run",
  );
  assert.equal(rawTrain503.result.isError, true);
  await assert.rejects(
    call(
      "ideogram_api",
      {
        operation: "train_dataset_model",
        allow_undocumented: true,
        params: { path: { dataset_id: "ds1" }, body: { model_name: "Planet Drip" } },
      },
      () => ({ status: 400, json: { error: "bad" } }),
    ),
    (e) => e.status === 400 && !/MAY have run/.test(e.message),
    "a refusal is the bare typed error: nothing ran",
  );
  const generate503 = await call("ideogram_generate", { prompt: "x" }, () => ({
    status: 503,
    json: { error: "down" },
  }));
  assert.match(
    text(generate503.result),
    /post_generate_image_v2_ideogram_v3 MAY have run and be billed/,
    "a family tool's generation likewise",
  );
  const list503 = await call("ideogram_models", {}, () => ({ status: 503, json: { error: "down" } })).catch((e) => e);
  assert.doesNotMatch(String(list503.message ?? text(list503.result)), /MAY have run/, "a GET carries no such note");
  const trainFileDir = join(dir, "not-a-dir-train");
  await writeFile(trainFileDir, "x");
  const trainUnwritable = await call(
    "ideogram_train",
    { dataset_id: "ds1", model_name: "Planet Drip" },
    () => ({ json: started }),
    join(trainFileDir, "out"),
  );
  assert.match(
    text(trainUnwritable.result),
    /^Training started: model Planet Drip \(m2\) from dataset ds1, status TRAINING\.\nFollow it with ideogram_models[^\n]*\nAs Ideogram sent it: not written to .*(ENOTDIR|not a directory)/i,
    "a started training is reported with its id whatever the disk does",
  );
  assert.equal(trainUnwritable.result.isError, undefined);
  assert.doesNotMatch(text(refused.result), /MAY have started/);
  const short = await call("ideogram_train", { dataset_id: "ds1", model_name: "abc" }, () => ({ json: started }));
  assert.match(text(short.result), /model_name must be 5-30 characters/);
  assert.equal(short.requests.length, 0);
  const typo = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip", steps: 3000 }, () => ({
    json: started,
  }));
  assert.match(text(typo.result), /steps/, "an unknown key is refused by name, never dropped");
  assert.equal(typo.requests.length, 0, "no billed training on a misspelled argument");
  for (const [args, rule] of [
    [{ training_steps: 250 }, /multiple of 100/],
    [{ lora_rank: 32 }, /64 or 128/],
    [{ ema: 1 }, /between 0 and 1/],
    [{ learning_rate: 0 }, /above 0/],
    [{ batch_size: 3 }, /1, 2, 4, 8, 16 or 32/],
    [{ base_variant: "x" }, /distilled_gd or oldbase_farzad_fused/],
  ]) {
    const r = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip", ...args }, () => ({
      json: started,
    }));
    assert.match(text(r.result), rule, JSON.stringify(args));
    assert.equal(r.requests.length, 0);
  }
  const mismatch = await call("ideogram_train", { dataset_id: "ds1", model_name: "Planet Drip" }, () => ({
    json: { model_id: 5 },
  }));
  assert.equal(mismatch.result.isError, true);
  assert.match(
    text(mismatch.result),
    /a training MAY have started and will be billed — list ideogram_models before starting it again/,
  );
});

test("ideogram_models lists with scope and repeated status, and shows one model; a 404 says what it means", async () => {
  const model = {
    model_id: "m2",
    name: "Planet Drip",
    status: "COMPLETED",
    dataset_id: "ds1",
    is_owned: true,
    is_available_for_generation: true,
    custom_model_uri: "model/planet-drip/version/1",
    creation_time: "2026-10-10T00:00:00Z",
    last_update_time: "2026-10-10T01:00:00Z",
  };
  const list = await call("ideogram_models", { scope: "owned", status: ["TRAINING", "COMPLETED"] }, () => ({
    json: { models: [model] },
  }));
  const q = new URL(list.requests[0].url, "http://x").searchParams;
  assert.deepEqual([q.get("scope"), q.getAll("status")], ["owned", ["TRAINING", "COMPLETED"]]);
  assert.match(
    text(list.result),
    /1 custom model\(s\)\.\n  Planet Drip \(m2\): COMPLETED, available for generation · model\/planet-drip\/version\/1/,
  );
  const one = await call("ideogram_models", { model_id: "m2" }, () => ({
    json: { model: { ...model, training_runs: [] } },
  }));
  assert.equal(one.requests[0].url, "/models/m2");
  assert.match(text(one.result), /Training runs: 0/);
  const gone = await call("ideogram_models", { model_id: "nope" }, () => ({ status: 404, json: { error: "no" } }));
  assert.match(text(gone.result), /not yours, not shared with your organization, or does not exist/);
  const both = await call("ideogram_models", { model_id: "m2", scope: "owned" }, () => ({ json: { model } }));
  assert.match(text(both.result), /scope and status apply to the list, not to one model by id/);
  const ds = await call("ideogram_datasets", { dataset_id: "ds1", search: "x" }, () => ({ json: {} }));
  assert.match(text(ds.result), /search applies to the list, not to one dataset by id/);
});
