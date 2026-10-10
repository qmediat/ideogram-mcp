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
  zCreateDatasetResponse, zGetCustomModelResponse, zGetDatasetResponse, zListCustomModelsResponse, zListDatasetsResponse, zTrainDatasetModelResponse, zUploadDatasetAssetsResponse,
} from "../generated/zod.gen.js";
import { bodySchemaFor, operationById } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import { loadUploads } from "../uploads.js";
import type { QueryValue } from "../wire.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import type { ToolArguments } from "./family.js";
import { apiErrorResult, readOperation } from "./reads.js";
import { jsonText, textResult } from "./results.js";

function operation(id: string): Operation {
  const op = operationById(id);
  if (op === null) throw new Error(`the snapshot lacks ${id}`);
  return op;
}

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

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ");
}

const DatasetsInput = z.object({
  dataset_id: z.string().min(1).optional().describe("One dataset: its files (name, size, caption) and the models trained from it"),
  search: z.string().max(64).optional().describe("Case-insensitive substring of the name, for the list"),
});

async function runDatasets(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = DatasetsInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_datasets: ${issues(input.error)}`, true);
  try {
    if (input.data.dataset_id !== undefined) {
      const one = await readOperation(ctx, { op: GET_DATASET, path: { dataset_id: input.data.dataset_id } }, zGetDatasetResponse);
      if (!one.ok) return one.result;
      const d = one.data;
      const files = d.files.map((f) => `  ${f.file_name}${f.file_size_bytes === undefined ? "" : ` (${f.file_size_bytes} bytes)`}${f.caption ? ` — ${f.caption}` : ""}`);
      return textResult([`Dataset ${d.dataset.name} (${d.dataset.dataset_id}): ${d.file_count} file(s), ${d.custom_model_ids.length} model(s) trained from it${d.custom_model_ids.length > 0 ? `: ${d.custom_model_ids.join(", ")}` : ""}.`, ...files, "As Ideogram sent it:", jsonText(one.raw)].join("\n"));
    }
    const query: Record<string, QueryValue> = input.data.search === undefined ? {} : { search: input.data.search };
    const list = await readOperation(ctx, { op: LIST_DATASETS, query }, zListDatasetsResponse);
    if (!list.ok) return list.result;
    const rows = list.data.datasets.map((d) => `  ${d.name} (${d.dataset_id}), created ${d.creation_time}`);
    return textResult([`${rows.length} dataset(s), most recently updated first.`, ...rows, "As Ideogram sent them:", jsonText(list.raw)].join("\n"));
  } catch (error) {
    return apiErrorResult(error, "ideogram_datasets", OWNER);
  }
}

const UploadInput = z.object({
  dataset_id: z.string().min(1).optional().describe("The dataset to upload into; or give name to create one first"),
  name: z.string().min(1).optional().describe("Create a new dataset with this name, then upload into it"),
  files: z.array(z.string().min(1)).min(1).max(100).describe("Image files (JPEG, PNG, WebP), .txt caption sidecars and/or .zip archives of both: local paths or public https URLs; a dataset holds up to 100 images"),
});

type Created = { readonly kind: "id"; readonly id: string } | { readonly kind: "result"; readonly result: CallToolResult };

async function createDataset(ctx: ToolContext, name: string): Promise<Created> {
  const schema = bodySchemaFor(CREATE_DATASET, "json");
  const body = { name };
  const checked = schema?.safeParse(body);
  if (checked !== undefined && !checked.success) return { kind: "result", result: textResult(`ideogram_dataset_upload: name: ${issues(checked.error)}`, true) };
  const made = await readOperation(ctx, { op: CREATE_DATASET, body: { media: "json", fields: body, files: [], jsonParts: [] } }, zCreateDatasetResponse);
  return made.ok ? { kind: "id", id: made.data.dataset_id } : { kind: "result", result: made.result };
}

async function runUpload(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = UploadInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_dataset_upload: ${issues(input.error)}`, true);
  if ((input.data.dataset_id === undefined) === (input.data.name === undefined)) return textResult("ideogram_dataset_upload: give dataset_id (an existing dataset) or name (a new one), not both", true);
  try {
    const uploads = await loadUploads(UPLOAD_ASSETS, input.data.files.map((path) => ({ field: "files", path })), ctx.remote);
    let datasetId: string;
    let created = "";
    if (input.data.dataset_id !== undefined) datasetId = input.data.dataset_id;
    else {
      const made = await createDataset(ctx, input.data.name as string);
      if (made.kind === "result") return made.result;
      datasetId = made.id;
      created = `Dataset ${input.data.name} created: ${datasetId}.\n`;
    }
    const answer = await readOperation(ctx, { op: UPLOAD_ASSETS, path: { dataset_id: datasetId }, body: { media: "multipart", fields: {}, files: uploads, jsonParts: [] } }, zUploadDatasetAssetsResponse);
    if (!answer.ok) return answer.result;
    const a = answer.data;
    const failed = a.failed_assets.map((f) => `  ${f.file_name}: ${f.failure_reason}`);
    const lines = [`${created}${a.success_count} of ${a.total_count} asset(s) uploaded to dataset ${datasetId}${a.failure_count > 0 ? `, ${a.failure_count} failed:` : "."}`, ...failed, "As Ideogram sent it:", jsonText(answer.raw)];
    return textResult(lines.join("\n"), a.success_count === 0);
  } catch (error) {
    return apiErrorResult(error, "ideogram_dataset_upload", OWNER);
  }
}

const TrainInput = z.object({
  model: z.enum(["ideogram-4", "ideogram-3"]).optional().describe("The base model: ideogram-4 (default) or ideogram-3"),
  dataset_id: z.string().min(1).describe("The dataset to train from (15 to 100 images)"),
  model_name: z.string().min(5).max(30).describe("The trained model's name: 5-30 characters, letters, digits, spaces and hyphens"),
  training_steps: z.number().int().optional().describe("Advanced: 100-10000, a multiple of 100 (default 1000)"),
  lora_rank: z.number().int().optional().describe("Advanced: 64 or 128 (default 128)"),
  ema: z.number().optional().describe("Advanced: the EMA decay, between 0 and 1 exclusive"),
  learning_rate: z.number().optional().describe("Advanced: above 0, typically 1e-5 to 1e-4"),
  batch_size: z.number().int().optional().describe("Advanced, ideogram-4 only: 1, 2, 4, 8, 16 or 32"),
  base_variant: z.string().optional().describe("Advanced, ideogram-4 only: the frozen backbone the LoRA is trained on"),
  wandb_project: z.string().optional().describe("Advanced, ideogram-4 only: a Weights & Biases project to log the run to"),
});
const HYPERPARAMETERS = ["training_steps", "lora_rank", "ema", "learning_rate", "batch_size", "base_variant", "wandb_project"] as const;

async function runTrain(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = TrainInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_train: ${issues(input.error)}`, true);
  const { model = "ideogram-4", ...rest } = input.data;
  const given = HYPERPARAMETERS.filter((h) => rest[h] !== undefined);
  const op = given.length > 0 ? TRAIN[model as TrainModel].advanced : TRAIN[model as TrainModel].plain;
  const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const schema = bodySchemaFor(op, "json");
  if (schema instanceof z.ZodObject) {
    const foreign = Object.keys(body).filter((k) => !(k in schema.shape));
    if (foreign.length > 0) return textResult(`ideogram_train: ${foreign.join(", ")} is not a parameter of ${model}'s training (${op.id})`, true);
  }
  const checked = schema?.safeParse(body);
  if (checked !== undefined && !checked.success) return textResult(`ideogram_train (${op.id}): ${issues(checked.error)}`, true);
  try {
    const answer = await readOperation(ctx, { op, body: { media: "json", fields: body, files: [], jsonParts: [] } }, zTrainDatasetModelResponse);
    if (!answer.ok) return answer.result;
    const t = answer.data;
    return textResult([`Training started: model ${t.model_name} (${t.model_id}) from dataset ${t.dataset_id}, status ${t.training_status}.`, `Follow it with ideogram_models {"model_id": "${t.model_id}"}; when it is COMPLETED, generate with its custom_model_uri (ideogram_generate, model ${model}-custom-model).`, "As Ideogram sent it:", jsonText(answer.raw)].join("\n"));
  } catch (error) {
    return apiErrorResult(error, "ideogram_train", OWNER);
  }
}

const ModelsInput = z.object({
  model_id: z.string().min(1).optional().describe("One model, with its training runs when it is yours"),
  scope: z.enum(["owned", "shared"]).optional().describe("owned (yours) or shared (the organization's registry); default both"),
  status: z.array(z.enum(["CREATING", "DRAFT", "TRAINING", "COMPLETED", "ERRORED", "ARCHIVED"])).optional().describe("Keep only these statuses (owned models)"),
});

function modelLine(m: { name: string; model_id: string; status: string; custom_model_uri?: string | null; is_available_for_generation?: boolean }): string {
  const uri = m.custom_model_uri ? ` · ${m.custom_model_uri}` : "";
  return `  ${m.name} (${m.model_id}): ${m.status}${m.is_available_for_generation ? ", available for generation" : ""}${uri}`;
}

async function runModels(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = ModelsInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_models: ${issues(input.error)}`, true);
  try {
    if (input.data.model_id !== undefined) {
      const one = await readOperation(ctx, { op: GET_MODEL, path: { model_id: input.data.model_id } }, zGetCustomModelResponse);
      if (!one.ok) return one.result;
      return textResult([`Model:`, modelLine(one.data.model), `Training runs: ${one.data.model.training_runs?.length ?? 0}`, "As Ideogram sent it:", jsonText(one.raw)].join("\n"));
    }
    const query: Record<string, QueryValue> = {};
    if (input.data.scope !== undefined) query.scope = input.data.scope;
    if (input.data.status !== undefined) query.status = input.data.status;
    const list = await readOperation(ctx, { op: LIST_MODELS, query }, zListCustomModelsResponse);
    if (!list.ok) return list.result;
    return textResult([`${list.data.models.length} custom model(s).`, ...list.data.models.map(modelLine), "As Ideogram sent them:", jsonText(list.raw)].join("\n"));
  } catch (error) {
    return apiErrorResult(error, "ideogram_models", "the model is not yours, not shared with your organization, or does not exist");
  }
}

export const DATASETS_TOOL: ToolDefinition = {
  name: "ideogram_datasets",
  title: "Datasets",
  description: "Your training datasets: the list (optionally searched by name), or one dataset by id with its files, captions and the models trained from it. Reads only.",
  inputSchema: DatasetsInput,
  handler: runDatasets,
};

export const DATASET_UPLOAD_TOOL: ToolDefinition = {
  name: "ideogram_dataset_upload",
  title: "Upload training assets",
  description: "Upload images (JPEG, PNG, WebP), .txt caption sidecars and .zip archives into a dataset — an existing one by dataset_id, or a new one created from name — from local paths or public https URLs; up to 100 images per dataset. Answers what was accepted and what failed and why.",
  inputSchema: UploadInput,
  handler: runUpload,
};

export const TRAIN_TOOL: ToolDefinition = {
  name: "ideogram_train",
  title: "Train a custom model",
  description: "Start training a custom Ideogram 4.0 (default) or 3.0 model from a dataset of 15 to 100 images. Any hyperparameter given routes to the advanced training operation, checked by its own schema. Returns the model id to follow with ideogram_models; a completed model's custom_model_uri generates through ideogram_generate.",
  inputSchema: TrainInput,
  handler: runTrain,
};

export const MODELS_TOOL: ToolDefinition = {
  name: "ideogram_models",
  title: "Custom models",
  description: "Your custom models and those shared with your organization: the list (by scope and status), or one by id with its training runs. Reads only.",
  inputSchema: ModelsInput,
  handler: runModels,
};

export const TRAINING_TOOLS: readonly ToolDefinition[] = [DATASETS_TOOL, DATASET_UPLOAD_TOOL, TRAIN_TOOL, MODELS_TOOL];
