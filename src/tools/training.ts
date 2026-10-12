/**
 * Custom-model training (step 3 of docs/DESIGN-ideogram-v2.md), on the v1 endpoints the index keeps for it: datasets
 * (list, search, one by id, create), the upload of a dataset's assets (images, .txt captions, .zip archives — local
 * files or public https URLs, through the one upload loader), the training of an Ideogram 4.0 or 3.0 model from a
 * dataset (the plain operation, or the advanced one the moment a hyperparameter is given — each checked by its own
 * schema), and the models (list, filter, one by id with its training runs). A listing prints its summary and the
 * answer as received.
 */
import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  zCreateDatasetResponse,
  zGetCustomModelResponse,
  zGetDatasetResponse,
  zListCustomModelsResponse,
  zListDatasetsResponse,
  zTrainDatasetModelResponse,
  zUploadDatasetAssetsResponse,
} from "../generated/zod.gen.js";
import { zModelStatus } from "../generated/zod.gen.js";
import { constraintViolations } from "../spec/overlay.js";
import { bodySchemaFor } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import { loadUploads } from "../uploads.js";
import type { QueryValue } from "../wire.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import type { ToolArguments } from "./family.js";
import { IdeogramApiError } from "../errors.js";
import {
  apiErrorResult,
  errorText,
  listingResult,
  operation,
  rawLines,
  readOperation,
  resultText,
  sendOperation,
} from "./reads.js";
import type { Sent, SideEffect } from "./reads.js";
import { textResult } from "./results.js";
import { issueText } from "../issues.js";

const LIST_DATASETS = operation("list_datasets");
const GET_DATASET = operation("get_dataset");
const CREATE_DATASET = operation("create_dataset");
const UPLOAD_ASSETS = operation("upload_dataset_assets");
const LIST_MODELS = operation("list_custom_models");
const GET_MODEL = operation("get_custom_model");

/** The training operations per model, plain and advanced. */
const TRAIN = {
  "ideogram-4": { plain: operation("train_model_v4"), advanced: operation("train_model_v4_advanced") },
  "ideogram-3": { plain: operation("train_model_v3"), advanced: operation("train_model_v3_advanced") },
} as const;
type TrainModel = keyof typeof TRAIN;

const OWNER = "the dataset is not yours or does not exist";
const LISTING = "this key cannot list datasets (Ideogram answers 404 to a key without access)";

const DatasetsInput = z
  .strictObject({
    dataset_id: z
      .string()
      .min(1)
      .optional()
      .describe("One dataset: its files (name, size, caption) and the models trained from it"),
    search: z.string().max(64).optional().describe("Case-insensitive substring of the name, for the list"),
  })
  .refine((v) => v.dataset_id === undefined || v.search === undefined, {
    message: "search applies to the list, not to one dataset by id",
  });

async function runDatasets(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = DatasetsInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_datasets: ${issueText(input.error)}`, true);
  try {
    if (input.data.dataset_id !== undefined) {
      const one = await readOperation(
        ctx,
        { op: GET_DATASET, path: { dataset_id: input.data.dataset_id } },
        zGetDatasetResponse,
      );
      if (!one.ok) return one.result;
      const d = one.data;
      const files = d.files.map(
        (f) =>
          `  ${f.file_name}${f.file_size_bytes === undefined ? "" : ` (${f.file_size_bytes} bytes)`}${f.caption ? ` — ${f.caption.length > 120 ? `${f.caption.slice(0, 120)}…` : f.caption}` : ""}`,
      );
      return listingResult(
        [
          `Dataset ${d.dataset.name} (${d.dataset.dataset_id}): ${d.file_count} file(s), ${d.custom_model_ids.length} model(s) trained from it${d.custom_model_ids.length > 0 ? `: ${d.custom_model_ids.join(", ")}` : ""}.`,
          ...files,
        ],
        await rawLines(ctx, "As Ideogram sent it", `dataset-${input.data.dataset_id}`, one.raw),
      );
    }
    const query: Record<string, QueryValue> = input.data.search === undefined ? {} : { search: input.data.search };
    const list = await readOperation(ctx, { op: LIST_DATASETS, query }, zListDatasetsResponse);
    if (!list.ok) return list.result;
    const rows = list.data.datasets.map((d) => `  ${d.name} (${d.dataset_id}), created ${d.creation_time}`);
    return listingResult(
      [`${rows.length} dataset(s), most recently updated first.`, ...rows],
      await rawLines(ctx, "As Ideogram sent them", `datasets-${ctx.clock.now()}`, list.raw),
    );
  } catch (error) {
    return apiErrorResult(error, "ideogram_datasets", input.data.dataset_id === undefined ? LISTING : OWNER);
  }
}

const UploadInput = z.strictObject({
  dataset_id: z.string().min(1).optional().describe("The dataset to upload into; or give name to create one first"),
  name: z.string().min(1).optional().describe("Create a new dataset with this name, then upload into it"),
  files: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .describe(
      "Images (JPEG, PNG, WebP), caption sidecars (.txt or .json, named like their image) and/or .zip archives of both: local paths or public https URLs; the file's NAME is sent (the API pairs a caption by it); a dataset holds up to 100 images",
    ),
});

type Created =
  { readonly kind: "id"; readonly id: string } | { readonly kind: "result"; readonly result: CallToolResult };

const CANNOT_CREATE = "this key cannot create datasets";

/** The dataset by name — made, or the failure typed: a refusal and a request that never left made nothing; anything
 * else (a 5xx, a cut connection, a 200 off the schema) MAY have made one, and says so before a retry makes a second. */
async function createDataset(ctx: ToolContext, name: string): Promise<Created> {
  const schema = bodySchemaFor(CREATE_DATASET, "json");
  const body = { name };
  const checked = schema?.safeParse(body);
  if (checked !== undefined && !checked.success)
    return { kind: "result", result: textResult(`ideogram_dataset_upload: name: ${issueText(checked.error)}`, true) };
  const sent = await sendOperation(
    ctx,
    { op: CREATE_DATASET, body: { media: "json", fields: body, files: [], jsonParts: [] } },
    zCreateDatasetResponse,
  );
  const mayExist = `A dataset named "${name}" MAY have been created: list ideogram_datasets before creating it again.`;
  if (sent.kind === "answer") {
    if (sent.read.ok) return { kind: "id", id: sent.read.data.dataset_id };
    return { kind: "result", result: textResult(`${resultText(sent.read.result)}\n${mayExist}`, true) };
  }
  const said = failureText(sent, "ideogram_dataset_upload", CANNOT_CREATE);
  return { kind: "result", result: textResult(sent.kind === "unknown" ? `${said}\n${mayExist}` : said, true) };
}

/** A failure as a tool says it: a 404 with what it means here, any other failure with the API's words. */
function failureText(sent: Extract<Sent<unknown>, { kind: SideEffect }>, what: string, notFoundMeans: string): string {
  const e = sent.error;
  if (e instanceof IdeogramApiError && e.status === 404)
    return `${what}: ${notFoundMeans} (Ideogram's answer: ${e.message}).`;
  return `${what}: ${errorText(e)}`;
}

async function runUpload(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = UploadInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_dataset_upload: ${issueText(input.error)}`, true);
  if ((input.data.dataset_id === undefined) === (input.data.name === undefined))
    return textResult(
      "ideogram_dataset_upload: give dataset_id (an existing dataset) or name (a new one), not both",
      true,
    );
  let uploads;
  try {
    uploads = await loadUploads(
      UPLOAD_ASSETS,
      input.data.files.map((path) => ({ field: "files", path })),
      ctx.remote,
    );
  } catch (error) {
    return apiErrorResult(error, "ideogram_dataset_upload", OWNER);
  }
  let datasetId: string;
  let created = "";
  if (input.data.dataset_id !== undefined) datasetId = input.data.dataset_id;
  else {
    const made = await createDataset(ctx, input.data.name as string);
    if (made.kind === "result") return made.result;
    datasetId = made.id;
    created = `Dataset ${input.data.name} created: ${datasetId}.\n`;
  }
  // from here the dataset exists whatever happens: its id is the first line of every answer, so a retry uses it
  // instead of making another (a failure of this tool's own code included)
  try {
    const lines = await uploadAssets(ctx, datasetId, uploads, created);
    return textResult(`${created}${lines.text}`, lines.isError);
  } catch (error) {
    return textResult(`${created}ideogram_dataset_upload: ${errorText(error)}`, true);
  }
}

/** The upload into an existing dataset, typed by what it did: done (with what failed per asset), refused or never sent
 * (nothing is in; upload again), or unknown (the assets MAY be in; a second upload would add them twice). */
async function uploadAssets(
  ctx: ToolContext,
  datasetId: string,
  uploads: Awaited<ReturnType<typeof loadUploads>>,
  created: string,
): Promise<{ text: string; isError: boolean }> {
  const sent = await sendOperation(
    ctx,
    {
      op: UPLOAD_ASSETS,
      path: { dataset_id: datasetId },
      body: { media: "multipart", fields: {}, files: uploads, jsonParts: [] },
    },
    zUploadDatasetAssetsResponse,
  );
  const again = created === "" ? "" : `Upload again with dataset_id "${datasetId}", not with name.\n`;
  const mayBeIn = `The assets MAY be in the dataset: show it (ideogram_datasets {"dataset_id": "${datasetId}"}) before uploading again — a second upload adds them twice.`;
  if (sent.kind === "answer") {
    if (!sent.read.ok) return { text: `${resultText(sent.read.result)}\n${mayBeIn}`, isError: true };
    const a = sent.read.data;
    const failed = a.failed_assets.map((f) => `  ${f.file_name ?? "(unnamed)"}: ${f.failure_reason}`);
    const head = `${a.success_count} of ${a.total_count} asset(s) uploaded to dataset ${datasetId}${a.failure_count > 0 ? `, ${a.failure_count} failed:` : "."}`;
    const kept = await rawLines(
      ctx,
      "As Ideogram sent it",
      `dataset-upload-${datasetId}-${ctx.clock.now()}`,
      sent.read.raw,
    );
    return { text: [head, ...failed, ...kept.lines].join("\n"), isError: a.success_count === 0 };
  }
  const said = failureText(sent, "ideogram_dataset_upload", OWNER);
  if (sent.kind === "unknown") return { text: `${said}\n${mayBeIn}`, isError: true };
  return { text: `Nothing was uploaded. ${again}${said}`, isError: true };
}

const TrainInput = z.strictObject({
  model: z.enum(["ideogram-4", "ideogram-3"]).optional().describe("ideogram-4 (default) or ideogram-3"),
  dataset_id: z.string().min(1).describe("The dataset (15-100 images)"),
  model_name: z.string().describe("5-30 characters: letters, digits, spaces, hyphens"),
  training_steps: z.number().int().optional().describe("100-10000, a multiple of 100"),
  lora_rank: z.number().int().optional().describe("64 or 128"),
  ema: z.number().optional().describe("EMA decay in (0, 1)"),
  learning_rate: z.number().optional().describe("above 0"),
  batch_size: z.number().int().optional().describe("ideogram-4: 1, 2, 4, 8, 16 or 32"),
  base_variant: z.string().optional().describe("ideogram-4: the backbone"),
  wandb_project: z.string().optional().describe("ideogram-4: a W&B project"),
});
const HYPERPARAMETERS = [
  "training_steps",
  "lora_rank",
  "ema",
  "learning_rate",
  "batch_size",
  "base_variant",
  "wandb_project",
] as const;

/** The training operation the arguments select (the advanced one when a hyperparameter is given) and its checked
 * body; a string is the tool's refusal. */
function trainRequest(
  model: TrainModel,
  rest: Omit<z.infer<typeof TrainInput>, "model">,
): { op: Operation; body: Record<string, unknown> } | string {
  const given = HYPERPARAMETERS.filter((h) => rest[h] !== undefined);
  const op = given.length > 0 ? TRAIN[model].advanced : TRAIN[model].plain;
  const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const schema = bodySchemaFor(op, "json");
  if (schema instanceof z.ZodObject) {
    const foreign = Object.keys(body).filter((k) => !(k in schema.shape));
    if (foreign.length > 0)
      return `ideogram_train: ${foreign.join(", ")} is not a parameter of ${model}'s training (${op.id})`;
  }
  const checked = schema?.safeParse(body);
  if (checked !== undefined && !checked.success) return `ideogram_train (${op.id}): ${issueText(checked.error)}`;
  const rules = constraintViolations(op, body);
  if (rules.length > 0) return `ideogram_train: ${rules.join("; ")}`;
  return { op, body };
}

async function runTrain(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = TrainInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_train: ${issueText(input.error)}`, true);
  const { model = "ideogram-4", ...rest } = input.data;
  const request = trainRequest(model as TrainModel, rest);
  if (typeof request === "string") return textResult(request, true);
  const { op, body } = request;
  const sent = await sendOperation(
    ctx,
    { op, body: { media: "json", fields: body, files: [], jsonParts: [] } },
    zTrainDatasetModelResponse,
  );
  const mayRun = "a training MAY have started and will be billed — list ideogram_models before starting it again.";
  if (sent.kind === "answer") {
    if (!sent.read.ok) return textResult(`${resultText(sent.read.result)}\nThe API answered 200: ${mayRun}`, true);
    const t = sent.read.data;
    const kept = await rawLines(ctx, "As Ideogram sent it", `train-${t.model_id}`, sent.read.raw); // best-effort: the training runs whatever this disk does
    return textResult(
      [
        `Training started: model ${t.model_name} (${t.model_id}) from dataset ${t.dataset_id}, status ${t.training_status}.`,
        `Follow it with ideogram_models {"model_id": "${t.model_id}"}; when it is COMPLETED, generate with its custom_model_uri (ideogram_generate, model ${model}-custom-model).`,
        ...kept.lines,
      ].join("\n"),
    );
  }
  // a refusal (4xx) and a request that never left started nothing; anything else may have
  const said = failureText(
    sent,
    "ideogram_train",
    "the dataset is not yours, does not exist, or this key cannot train",
  );
  return textResult(sent.kind === "unknown" ? `${said}\nThe request had left this machine: ${mayRun}` : said, true);
}

const ModelsInput = z
  .strictObject({
    model_id: z.string().min(1).optional().describe("One model, with its training runs when it is yours"),
    scope: z
      .enum(["owned", "shared"])
      .optional()
      .describe("owned (yours) or shared (the organization's registry); default both"),
    status: z.array(zModelStatus).optional().describe("Keep only these statuses (owned models)"),
  })
  .refine((v) => v.model_id === undefined || (v.scope === undefined && v.status === undefined), {
    message: "scope and status apply to the list, not to one model by id",
  });

function modelLine(m: {
  name: string;
  model_id: string;
  status: string;
  custom_model_uri?: string | null;
  is_available_for_generation?: boolean;
}): string {
  const uri = m.custom_model_uri ? ` · ${m.custom_model_uri}` : "";
  return `  ${m.name} (${m.model_id}): ${m.status}${m.is_available_for_generation ? ", available for generation" : ""}${uri}`;
}

async function runModels(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = ModelsInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_models: ${issueText(input.error)}`, true);
  try {
    if (input.data.model_id !== undefined) {
      const one = await readOperation(
        ctx,
        { op: GET_MODEL, path: { model_id: input.data.model_id } },
        zGetCustomModelResponse,
      );
      if (!one.ok) return one.result;
      return listingResult(
        [`Model:`, modelLine(one.data.model), `Training runs: ${one.data.model.training_runs?.length ?? 0}`],
        await rawLines(ctx, "As Ideogram sent it", `model-${input.data.model_id}`, one.raw),
      );
    }
    const query: Record<string, QueryValue> = {};
    if (input.data.scope !== undefined) query.scope = input.data.scope;
    if (input.data.status !== undefined) query.status = input.data.status;
    const list = await readOperation(ctx, { op: LIST_MODELS, query }, zListCustomModelsResponse);
    if (!list.ok) return list.result;
    return listingResult(
      [`${list.data.models.length} custom model(s).`, ...list.data.models.map(modelLine)],
      await rawLines(ctx, "As Ideogram sent them", `models-${ctx.clock.now()}`, list.raw),
    );
  } catch (error) {
    return apiErrorResult(
      error,
      "ideogram_models",
      "the model is not yours, not shared with your organization, or does not exist",
    );
  }
}

export const DATASETS_TOOL: ToolDefinition = {
  name: "ideogram_datasets",
  title: "Datasets",
  description:
    "Your training datasets: the list (optionally searched by name), or one dataset by id with its files, captions and the models trained from it. Reads only.",
  inputSchema: DatasetsInput,
  handler: runDatasets,
};

export const DATASET_UPLOAD_TOOL: ToolDefinition = {
  name: "ideogram_dataset_upload",
  title: "Upload training assets",
  description:
    "Upload images (JPEG, PNG, WebP), caption sidecars (.txt/.json named like their image) and .zip archives into a dataset — an existing one by dataset_id, or a new one created from name — from local paths or public https URLs. Answers what was accepted and what failed and why.",
  inputSchema: UploadInput,
  handler: runUpload,
};

export const TRAIN_TOOL: ToolDefinition = {
  name: "ideogram_train",
  title: "Train a custom model",
  description:
    "Start training a custom Ideogram 4.0 (default) or 3.0 model from a dataset of 15-100 images; a hyperparameter routes to the advanced operation. Returns the model id to follow with ideogram_models; a completed model's custom_model_uri generates through ideogram_generate.",
  inputSchema: TrainInput,
  handler: runTrain,
};

export const MODELS_TOOL: ToolDefinition = {
  name: "ideogram_models",
  title: "Custom models",
  description:
    "Your custom models and those shared with your organization: the list (by scope and status), or one by id with its training runs. Reads only.",
  inputSchema: ModelsInput,
  handler: runModels,
};

export const TRAINING_TOOLS: readonly ToolDefinition[] = [DATASETS_TOOL, DATASET_UPLOAD_TOOL, TRAIN_TOOL, MODELS_TOOL];
