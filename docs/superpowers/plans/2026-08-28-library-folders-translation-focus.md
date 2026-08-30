# Library Folders and Focused Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent single-level course folders to the local PDF library and replace the crowded translation stack with a reliable one-record-at-a-time translation inspector.

**Architecture:** Dexie version 3 owns folder identity, uniqueness, document assignment, and safe folder deletion. The library client performs persistence while the library screen owns filtering and dialogs. PDF marks emit concrete mark IDs; the reader produces a focus request for every click, and the inspector resolves that request to one detail card with collapsed history and an overflow action menu.

**Tech Stack:** Next.js App Router, React, TypeScript, Dexie/IndexedDB, Vitest, Testing Library, Playwright, existing CSS design tokens.

**Spec:** `docs/superpowers/specs/2026-08-28-library-folders-translation-focus-design.md`

## Global Constraints

- A document belongs to at most one folder; nested folders and multi-folder tags are excluded.
- Deleting a folder clears only document `folderId` values and the folder row; PDFs, progress, translations, annotations, and vocabulary remain.
- Existing documents migrate without rewriting their PDF Blob and appear under “未分类”.
- Translation content shows one focused record with only original and translated text; page/language/model/time metadata stay hidden.
- Vocabulary and explicit retranslation remain available from the overflow menu.
- Translation cache keys, API calls, note bundle schema, and token usage semantics do not change.
- Use the current Next.js 16 documentation under `node_modules/next/dist/docs/` before changing App Router code.

---

### Task 1: Folder domain model and transactional persistence

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/database.ts`
- Modify: `src/lib/database.test.ts`

**Interfaces:**
- Produces: `LibraryFolder { id, name, normalizedName, createdAt, updatedAt }`.
- Produces: optional `DocumentRecord.folderId?: string`.
- Produces: `normalizeFolderName(name: string): string`.
- Produces: `createLibraryFolder(database, name): Promise<LibraryFolder>`.
- Produces: `renameLibraryFolder(database, folderId, name): Promise<LibraryFolder>`.
- Produces: `deleteLibraryFolder(database, folderId): Promise<{ documentsUnfiled: number }>`.
- Produces: `moveDocumentToFolder(database, documentId, folderId?): Promise<boolean>`.

- [ ] **Step 1: Write failing folder persistence and migration tests**

Add literal behavior tests to `src/lib/database.test.ts`:

```ts
it("normalizes course folder names and rejects duplicate display variants", async () => {
  const database = createDatabase();
  const folder = await createLibraryFolder(database, "  Robot   Control  ");
  expect(folder).toMatchObject({ name: "Robot Control", normalizedName: "robot control" });
  await expect(createLibraryFolder(database, "robot control")).rejects.toThrow("文件夹已存在");
});

it("opens version 2 documents as unfiled without changing their PDF", async () => {
  const name = `modu-folder-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(2).stores({
    documents: "&id,&fingerprint,lastOpenedAt,title",
    translations: "&id,&cacheKey,updatedAt",
    translationMarks: "&id,documentId,translationId,updatedAt",
    annotations: "&id,documentId,kind,updatedAt",
    vocabulary: "&id,documentId,translationId,mastered,favorite,updatedAt",
    pendingBundles: "&id,&fingerprint,importedAt",
  });
  await legacy.table("documents").put(documentRecord);
  legacy.close();
  const database = new ReaderDatabase(name);
  databases.push(database);
  const migrated = await database.documents.get(documentRecord.id);
  expect(migrated?.folderId).toBeUndefined();
  await expect(migrated?.file.text()).resolves.toBe("%PDF");
});

it("deletes a folder without deleting documents or study records", async () => {
  const database = createDatabase();
  const folder = await createLibraryFolder(database, "Robotics");
  await database.documents.put({ ...documentRecord, folderId: folder.id });
  await database.translations.put(translation);
  const result = await deleteLibraryFolder(database, folder.id);
  expect(result).toEqual({ documentsUnfiled: 1 });
  await expect(database.documents.get(documentRecord.id)).resolves.toMatchObject({ id: documentRecord.id });
  expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
  await expect(database.translations.get(translation.id)).resolves.toEqual(translation);
});

it("moves a document only when the destination folder exists", async () => {
  const database = createDatabase();
  await database.documents.put(documentRecord);
  await expect(moveDocumentToFolder(database, documentRecord.id, "missing")).rejects.toThrow("文件夹不存在");
  expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
});
```

- [ ] **Step 2: Run the database tests and verify the new cases fail**

Run: `npm run test:run -- src/lib/database.test.ts`

Expected: FAIL because the folder type, table, and helper functions do not exist.

- [ ] **Step 3: Add the type, schema version, and exact folder operations**

Implement the public contract in `src/lib/types.ts` and `src/lib/database.ts`:

```ts
export interface LibraryFolder {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeFolderName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
```

Use Dexie version 3 stores:

```ts
this.version(3).stores({
  ...stores,
  documents: "&id,&fingerprint,lastOpenedAt,title,folderId",
  folders: "&id,&normalizedName,updatedAt",
});
```

Validate display names after whitespace folding: empty names throw `文件夹名不能为空`, names over 60 characters throw `文件夹名最多 60 个字符`, and normalized duplicates throw `文件夹已存在`. Delete folders in one transaction over `folders` and `documents`; use `delete document.folderId` inside collection modification so unfiled queries work.

- [ ] **Step 4: Run the database test file and typecheck**

Run: `npm run test:run -- src/lib/database.test.ts && npm run typecheck`

Expected: all database tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the folder persistence checkpoint**

```bash
git add src/lib/types.ts src/lib/database.ts src/lib/database.test.ts
git commit -m "feat: add persistent library folders"
```

---

### Task 2: Folder navigation and document movement UI

**Files:**
- Modify: `src/components/library/library-screen.tsx`
- Modify: `src/components/library/library-screen.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `LibraryFolder` data through view models, not Dexie directly.
- Produces: `LibraryFolderView { id, name, documentCount }`.
- Produces callbacks: `onCreateFolder(name)`, `onRenameFolder(folderId, name)`, `onDeleteFolder(folderId)`, and `onMoveDocument(documentId, folderId?)`.
- Produces: `LibraryDocumentView.folderId?: string`.

- [ ] **Step 1: Write failing component tests for filtering and folder actions**

Add fixtures for two folders and three documents, then add these user-visible tests:

```tsx
it("filters documents by course folder and moves a document", async () => {
  const onMoveDocument = vi.fn();
  render(<LibraryScreen
    documents={folderDocuments}
    folders={[{ id: "robotics", name: "Robotics", documentCount: 2 }]}
    pendingBundles={[]}
    onImport={vi.fn()}
    onMoveDocument={onMoveDocument}
  />);
  await userEvent.click(screen.getByRole("button", { name: "Robotics 2" }));
  expect(screen.getByText("Kinematics")).toBeInTheDocument();
  expect(screen.queryByText("Linear Algebra")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "移动文献：Kinematics" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "未分类" }));
  expect(onMoveDocument).toHaveBeenCalledWith("kinematics", undefined);
});

it("creates and renames a course folder", async () => {
  const onCreateFolder = vi.fn();
  const onRenameFolder = vi.fn();
  render(<LibraryScreen
    documents={folderDocuments}
    folders={[{ id: "robotics", name: "Robotics", documentCount: 2 }]}
    pendingBundles={[]}
    onImport={vi.fn()}
    onCreateFolder={onCreateFolder}
    onRenameFolder={onRenameFolder}
  />);
  await userEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
  await userEvent.type(screen.getByLabelText("文件夹名称"), "Robot Control");
  await userEvent.click(screen.getByRole("button", { name: "创建" }));
  expect(onCreateFolder).toHaveBeenCalledWith("Robot Control");
  await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
  await userEvent.clear(screen.getByLabelText("文件夹名称"));
  await userEvent.type(screen.getByLabelText("文件夹名称"), "Advanced Robotics");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onRenameFolder).toHaveBeenCalledWith("robotics", "Advanced Robotics");
});

it("warns that deleting a folder keeps every document", async () => {
  render(<LibraryScreen
    documents={folderDocuments}
    folders={[{ id: "robotics", name: "Robotics", documentCount: 2 }]}
    pendingBundles={[]}
    onImport={vi.fn()}
    onDeleteFolder={vi.fn()}
  />);
  await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
  expect(screen.getByRole("dialog", { name: "删除文件夹" })).toHaveTextContent(
    "2 份文献将移至未分类",
  );
});
```

- [ ] **Step 2: Run the library screen tests and verify they fail**

Run: `npm run test:run -- src/components/library/library-screen.test.tsx`

Expected: FAIL because folder props and controls are missing.

- [ ] **Step 3: Implement the focused folder UI without database access**

Extend `LibraryScreenProps` with `folders?: LibraryFolderView[]` and the four optional callbacks. Add state whose exact filter union is:

```ts
type FolderFilter = "all" | "unfiled" | { folderId: string };
```

Render desktop folder navigation beside the document list and a mobile `<select aria-label="筛选文件夹">`. Filter before applying the existing pinned/recent sort. Add a folder button to each document action area with a `role="menu"` chooser. Reuse one accessible name dialog for create/rename, and a separate delete confirmation that includes the literal retained-data copy from the spec.

- [ ] **Step 4: Add scoped responsive CSS**

Add `.library-browser`, `.folder-sidebar`, `.folder-nav-item`, `.folder-mobile-select`, `.document-folder-menu`, and `.folder-dialog` styles. Keep the existing document row grid at desktop width; below 900px place folder navigation above the list, and below 760px show only the mobile selector. Use existing `--surface`, `--border`, `--navy-*`, and `--blue-*` tokens.

- [ ] **Step 5: Run the screen tests and typecheck**

Run: `npm run test:run -- src/components/library/library-screen.test.tsx && npm run typecheck`

Expected: all library screen tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the folder presentation checkpoint**

```bash
git add src/components/library/library-screen.tsx src/components/library/library-screen.test.tsx src/app/globals.css
git commit -m "feat: add course folder controls"
```

---

### Task 3: Connect library folders to stored and session documents

**Files:**
- Modify: `src/components/library/library-client.tsx`
- Modify: `src/components/library/library-client.test.tsx`

**Interfaces:**
- Consumes: Task 1 database helpers and Task 2 view/callback contracts.
- Produces: refreshed folder counts and persisted document assignments.
- Preserves: session-only document support through `updateEphemeralDocument`.

- [ ] **Step 1: Write failing client integration tests**

Create a folder through the rendered screen, move `documentRecord`, and assert real IndexedDB state:

```tsx
it("creates a course folder and persists a document assignment", async () => {
  const database = getReaderDatabase();
  render(<LibraryClient />);
  await screen.findByText("Vocabulary source");
  await userEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
  await userEvent.type(screen.getByLabelText("文件夹名称"), "Robotics");
  await userEvent.click(screen.getByRole("button", { name: "创建" }));
  await userEvent.click(screen.getByRole("button", { name: "移动文献：Vocabulary source" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Robotics" }));
  expect((await database.documents.get(documentRecord.id))?.folderId).toBeDefined();
});

it("deletes the folder and keeps its document and vocabulary", async () => {
  const database = getReaderDatabase();
  const folder = await createLibraryFolder(database, "Robotics");
  await database.documents.update(documentRecord.id, { folderId: folder.id });
  render(<LibraryClient />);
  await screen.findByRole("button", { name: "Robotics 1" });
  await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
  await userEvent.click(screen.getByRole("button", { name: "确认删除文件夹" }));
  await waitFor(async () => expect(await database.folders.get(folder.id)).toBeUndefined());
  expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
  await expect(database.vocabulary.get(vocabulary.id)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run the client test and verify the integration cases fail**

Run: `npm run test:run -- src/components/library/library-client.test.tsx`

Expected: FAIL because `LibraryClient` does not load folders or supply callbacks.

- [ ] **Step 3: Load folder views and implement handlers**

Update `refresh()` to read `database.folders.toArray()` alongside documents and pending bundles, then sort the small folder array with `name.localeCompare(..., "zh-CN")`. Build counts from the combined stored and ephemeral document list:

```ts
const folderViews = folders.map((folder) => ({
  id: folder.id,
  name: folder.name,
  documentCount: allDocuments.filter((document) => document.folderId === folder.id).length,
}));
```

Call the Task 1 helpers from create/rename/delete handlers, map errors through `errorMessage`, set short Chinese success messages, and always `await refresh()`. For document movement, call `moveDocumentToFolder`; if it returns `false`, verify the target folder and update the session record with `updateEphemeralDocument(documentId, { folderId })`.

- [ ] **Step 4: Run library client and screen tests together**

Run: `npm run test:run -- src/components/library/library-client.test.tsx src/components/library/library-screen.test.tsx`

Expected: both files PASS.

- [ ] **Step 5: Commit the connected library checkpoint**

```bash
git add src/components/library/library-client.tsx src/components/library/library-client.test.tsx
git commit -m "feat: persist document folder organization"
```

---

### Task 4: Reliable mark-level translation focus and simplified inspector

**Files:**
- Modify: `src/components/reader/pdf-page.tsx`
- Modify: `src/components/reader/continuous-viewer.tsx`
- Modify: `src/components/reader/book-viewer.tsx`
- Modify: `src/components/reader/reader-client.tsx`
- Modify: `src/components/reader/inspector-panel.tsx`
- Modify: `src/components/reader/pdf-page.test.tsx`
- Modify: `src/components/reader/inspector-panel.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `TranslationFocusRequest { markId: string; requestId: number }` local reader state.
- Changes: every `onTranslationClick` callback receives `markId`, never shared `translationId`.
- Changes: `createTranslationMark(...)` returns `Promise<TranslationMark>`.
- Changes: `InspectorPanel` consumes `translationFocus?: TranslationFocusRequest` and `onSelectTranslation(markId)`.

- [ ] **Step 1: Write failing mark identity and focused inspector tests**

In `pdf-page.test.tsx`, render one mark with a rectangle, activate rendering, click `查看翻译：state`, and assert `onTranslationClick` receives `mark-1` rather than `translation-1`.

Replace the existing inspector action test with focused behavior tests:

```tsx
it("shows only the focused translation and keeps history collapsed", async () => {
  render(<InspectorPanel
    translations={[{ payload: translation, mark }, { payload: secondTranslation, mark: secondMark }]}
    translationFocus={{ markId: "mark-1", requestId: 1 }}
    {...callbacks}
  />);
  expect(screen.getByText("state of the art")).toBeVisible();
  expect(screen.queryByText(secondTranslation.translatedText)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "翻译记录 2" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("第 12 页")).not.toBeInTheDocument();
});

it("reopens the same translation after switching to notes", async () => {
  const view = render(<InspectorPanel translationFocus={{ markId: "mark-1", requestId: 1 }} {...props} />);
  await userEvent.click(screen.getByRole("tab", { name: "注释" }));
  view.rerender(<InspectorPanel translationFocus={{ markId: "mark-1", requestId: 2 }} {...props} />);
  expect(screen.getByRole("tab", { name: "翻译" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("最先进的")).toBeVisible();
});

it("keeps vocabulary and retranslation inside the more menu", async () => {
  await userEvent.click(screen.getByRole("button", { name: "更多翻译操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "加入词汇本" }));
  expect(onAddVocabulary).toHaveBeenCalledWith("translation-1", "mark-1");
});
```

- [ ] **Step 2: Run the two reader component tests and verify they fail**

Run: `npm run test:run -- src/components/reader/pdf-page.test.tsx src/components/reader/inspector-panel.test.tsx`

Expected: FAIL because marks emit translation IDs and the inspector renders the full stack.

- [ ] **Step 3: Propagate mark IDs and issue a focus request per click**

Change `PdfPage`, `ContinuousViewer`, and `BookViewer` callback signatures to `(markId: string) => void`. In the mark button use:

```tsx
onClick={(event) => {
  event.stopPropagation();
  onTranslationClick(mark.id);
}}
```

In `ReaderClient`, keep a monotonic counter in a ref and focus with:

```ts
const focusTranslation = useCallback((markId: string) => {
  translationRequestRef.current += 1;
  setTranslationFocus({ markId, requestId: translationRequestRef.current });
}, []);
```

Return the existing or newly created `TranslationMark` from `createTranslationMark`, then call `focusTranslation(mark.id)` for cache hits and API results. Pass `focusTranslation` to both viewer modes.

- [ ] **Step 4: Render one translation, collapsed history, and overflow actions**

In `InspectorPanel`, select by exact mark ID; fall back to the newest translation only when no focus exists. Depend on `translationFocus?.requestId` when switching the internal tab to `translation`. Render:

```tsx
<button aria-expanded={historyOpen} aria-label={`翻译记录 ${sortedTranslations.length}`}>
  翻译记录 <span>{sortedTranslations.length}</span>
</button>
<article className="translation-card">
  <header><span>原文与译文</span><button aria-label="更多翻译操作" /></header>
  <div className="translation-content"><span>原文</span><p>{active.payload.originalText}</p></div>
  <div className="translation-content is-translated"><span>译文</span><p>{active.payload.translatedText}</p></div>
</article>
```

The history list uses compact buttons with truncated original text and calls `onSelectTranslation(mark.id)`. The overflow menu uses `role="menu"` and `role="menuitem"`; close it after either action.

- [ ] **Step 5: Replace stacked-card CSS with focused styles**

Remove visual dependency on `.translation-meta` and `.translation-actions`. Add `.translation-history`, `.translation-history-list`, `.translation-card-header`, `.translation-more-menu`, and `.translation-content` rules. Cap the history list height, use ellipsis for long originals, and keep the detail card readable without page metadata.

- [ ] **Step 6: Run reader tests and typecheck**

Run: `npm run test:run -- src/components/reader/pdf-page.test.tsx src/components/reader/inspector-panel.test.tsx && npm run typecheck`

Expected: both files PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the focused translation checkpoint**

```bash
git add src/components/reader/pdf-page.tsx src/components/reader/continuous-viewer.tsx src/components/reader/book-viewer.tsx src/components/reader/reader-client.tsx src/components/reader/inspector-panel.tsx src/components/reader/pdf-page.test.tsx src/components/reader/inspector-panel.test.tsx src/app/globals.css
git commit -m "fix: focus saved translations by highlight"
```

---

### Task 5: End-to-end regression and full verification

**Files:**
- Modify: `tests/e2e/reader-flow.spec.ts`

**Interfaces:**
- Consumes: completed folder UI and focused translation inspector.
- Produces: browser-level proof for refresh persistence, safe folder deletion, compact translation focus, and repeated highlight recall.

- [ ] **Step 1: Extend the Playwright flow with folder organization**

After importing the PDF, stay on the library route long enough to create `Robotics`, move the sample document into it, reload, select the folder, and assert the document remains visible. Near the end, delete the folder and assert the document is visible under `未分类` and still opens.

- [ ] **Step 2: Extend the translation flow with focused recall**

After translation, open the overflow menu and add the record to vocabulary. Switch to the Notes tab, click the blue highlight, and assert the Translation tab becomes selected with exactly one `.translation-card`. Repeat the Notes-tab/highlight sequence once more to cover same-mark recall. Assert the detail area contains original and translated text but no `第 1 页` or `en → zh-CN` metadata.

- [ ] **Step 3: Run the focused unit and component suite**

Run: `npm run test:run -- src/lib/database.test.ts src/components/library/library-screen.test.tsx src/components/library/library-client.test.tsx src/components/reader/pdf-page.test.tsx src/components/reader/inspector-panel.test.tsx`

Expected: all selected tests PASS.

- [ ] **Step 4: Run the complete project verification**

Run: `npm run test:run && npm run typecheck && npm run build`

Expected: every Vitest file passes, TypeScript exits 0, and Next.js reports a successful production build.

- [ ] **Step 5: Run the Playwright end-to-end flow**

Run: `npm run test:e2e -- tests/e2e/reader-flow.spec.ts`

Expected: the complete import/folder/read/translate/recall/delete/export flow passes with no browser console errors.

- [ ] **Step 6: Perform in-app Browser visual QA**

At `http://127.0.0.1:3000/`, verify desktop folder navigation, mobile folder selector, document movement, non-destructive folder deletion, compact translation history, one visible translation card, overflow actions, and repeated blue-highlight recall. Capture one library screenshot and one reader screenshot outside the repository.

- [ ] **Step 7: Commit the end-to-end regression**

```bash
git add tests/e2e/reader-flow.spec.ts
git commit -m "test: cover folders and focused translation recall"
```
