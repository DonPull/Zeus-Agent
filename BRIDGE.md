# UI/core bridge contract

React calls the Rust core only through `src/bridge/index.js`. SQLite owns durable messages, sequence, visibility, runs and attachment links. Subscribe, hydrate and upsert by message ID/sequence; never create a durable-looking optimistic message. Existing browser APIs retain their current coverage limits pending Phase 3B-3D.

## Phase 3A attachment APIs

`saveTaskAttachment(taskId, filename, base64Data)` returns an attachment object, replacing the former path string. Its fields are `id`, `task_id`, `filename`, `storage_key`, `mime_type`, `byte_count`, `sha256`, optional `width`/`height`, `created_at`, `status` and `last_delivery`. Treat `storage_key` as metadata; send the stable ID. All internal callers use this contract. Old text-only message callers remain compatible.

Uploads detect and decode actual content. Static PNG/JPEG/WebP images allow 10 MiB and 25 million pixels each. Messages allow eight attachments and 30 MiB total; generic files retain a separate non-image path. Same-name files have distinct UUID directories. Linked uploads are retained; opportunistic cleanup removes at most two unchanged, unlinked uploads older than seven days per upload operation. This is logical identity/integrity validation, not OS-enforced immutable storage or a sandbox.

`sendUserMessage(taskId, content, requestId, attachmentIds = [])` validates task ownership, content integrity, explicit denials and image-route readiness before acceptance. The run, user message and ordered attachment links commit together. Reusing a request ID returns `REQUEST_ALREADY_EXISTS`; it never starts another inference. Empty text is valid with attachments. Preflight failure leaves the input unaccepted.

`onUserMessageAccepted(callback)` returns an unlisten function. Its payload is `{task_id, request_id, message_id}` and is emitted after the acceptance transaction commits. Install it before sending; clear only the matching task/request's captured draft/tray. The send promise resolves after execution, so an inference failure can occur after acceptance. Durable `task-message` events and `getTaskMessages` remain authoritative if an event is missed.

`getTaskMessages(taskId, includeHidden = false)` includes ordered `attachments` on each message. `last_delivery` is a derived latest attempt across reuse, with `state`, `error`, serialized `route`, and nullable `request_id`. It is separate from upload `status: ready`; provider delivery success does not establish comprehension. Re-emitted delivery snapshots retain the message's ID and sequence.

Normal `getTaskMessages` remains master-only. `getTaskDebugMessages(taskId)` explicitly requests hidden messages and all task conversations through the optional `includeAllConversations` backend flag. Debug exports contain the visible master transcript and every stored raw conversation, with message/model/attachment metadata and latest run/usage snapshots. The backend event log remains a volatile 2,000-entry ring per task: restart loses those events, and the export labels that coverage gap. Original image bytes/previews and credential-vault contents are not fetched for the report.

`getAttachmentPreview(taskId, attachmentId)` verifies ownership, containment, denials and SHA-256 before returning a bounded PNG thumbnail data URL. Fetch lazily for image chips. Bytes are transient in preview/provider payloads, absent from persisted chat text. `attachment:<id>` is the stable handle accepted by the `analyze_visual` tool for deliberate follow-up inspection. Legacy path notes are readable history; they are not automatically imported or reconstructed.

Errors carry stable prefixes such as `ATTACHMENT_MEDIA`, `ATTACHMENT_QUOTA`, `ATTACHMENT_CHANGED`, `ATTACHMENT_OWNERSHIP`, `ATTACHMENT_PATH`, `ATTACHMENT_DENIED`, `ATTACHMENT_CAPABILITY` and `ATTACHMENT_EMPTY_ANALYSIS`. Preserve the original provider rejection. A visual tool failure returns `{ok:false,error:{code,message}}` inside the directive result, rather than a successful-looking analysis string. Stop and restart retain cancelled/interrupted delivery evidence.

## Provider and image settings

`fetchModelCatalogue()` returns connection-labelled entries with `connection`, `status`, `models`, `observed_at`, and nullable `error`. Supported connections are `abacus`, `gemini`, `xiaomi` and `local`. Missing credentials/unreachable catalogues have explicit states; a model listing is availability evidence, not a capability guarantee. `fetchAvailableModels()` remains a flattened compatibility wrapper and loses connection identity.

Task and global settings include `model_bindings`, keyed by enabled role (`master`, `worker`, `verifier`, `watcher`, `vision`). Each value contains `connection`, exact `model_id`, `protocol: auto|chat|responses`, `image_input: unknown|supported|unsupported`, and `source`. The compatibility connection `legacy` resolves the former route once; ordinary new hosted selections bind Abacus. A binding must match the role's model ID. Disabled roles have no binding. Task updates are transactional; stale bindings reject the whole update.

`image_delivery: auto|helper` is persisted alongside bindings. Auto sends actual images to a confirmed capable actor; otherwise it requires a configured capable helper. Helper mode explicitly uses that helper even when the actor supports images. Unknown models require a declared capability or capable helper; there is no silent image removal or model/provider substitution. The initial helper call is deterministic. Follow-up tool inspection uses the configured helper, or a capable master when the helper is disabled, through shared permission and cancellation handling.

Existing tasks/defaults preserve legacy provider behavior until explicitly changed, avoiding an unrequested change of billable provider. To use an existing Gemini-named selection through Abacus, select **Abacus** in that role's provider control. Direct Google development still requires its separate Google credential. Protocol and image-support overrides are under **Model input settings**. Credentials stay in the OS credential store, never in bindings or trial manifests.

Usage summaries include `requests_by_connection` alongside actual endpoint origins and roles. Per-request accounting retains the declared binding, resolved protocol and capability provenance; provider credits remain unknown where unavailable. Provider identity is a routing contract. The actor receives configured model/provider/effort metadata, which is configuration evidence rather than independently verified model weights.

## Stabilization policy and error handling

Attachment reads and file tools use the same Windows-aware file-policy identity. Explicit rules retain their task/global specificity and are evaluated before automatic allowances. Local relative/new paths resolve against the task workspace and existing canonical ancestors; workspace containment uses component boundaries. Explicit UNC/device paths are evaluated lexically without network metadata probes and require a matching explicit rule or approval. This is logical authorization, not a race-free filesystem sandbox. Existing explicit-local and legacy-evaluation relaxations remain for the later approval design.

Normal one-time approval APIs remain the only route used by the prepared synthetic diagnostic supervisor. It is controller-owned, task-scoped, restricted to declared bounded native file operations and independent of outcome grading. It never installs persistent rules or broadly approves scripts. Production Smart approvals are not implemented by this controller.

Final-answer preambles remain hidden raw history; one final summary is visible. Ordinary chat can finish without an executable directive. Malformed directives and narrowly detected short action announcements receive bounded repair rather than endless forced continuation. This does not establish semantic task completion. Recoverable render boundaries protect settings/root views; they do not catch native process aborts. Startup changes in-flight ledger rows to interrupted with unknown usage retained.
