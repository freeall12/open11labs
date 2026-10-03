import { PageFrame } from "@/features/shared/PageFrame";
import { routeById, LOCAL_ROUTES } from "@/app/route-manifest";
import { ProviderSettingsPage } from "@/features/core/ProviderSettingsPage";
import { LocalJobsPageBody } from "@/features/core/LocalJobsPage";
import { LocalStorageSettingsPageBody } from "@/features/core/LocalStorageSettingsPage";
import {
  FilesHeaderActions,
  FilesPageBody,
  useFilesController,
} from "@/features/storage/FilesPage";
import { BrandKitsPage as BrandKitsBody } from "@/features/editors/BooksAndKits";

/* ==========================================================================
   STORAGE + CORE modules.

   Storage: local folders, files, brand kits. The upstream account/workspace
   filters are excluded by SCOPE.md, so there is no owner or member filter
   here — this build is single-user and local.

   The LOCAL_ROUTES pages are BYOK configuration, not part of the upstream
   surface. They are local extensions and are labelled as such on screen.
   ========================================================================== */

export function FilesPage() {
  const route = routeById("files");
  if (!route) throw new Error("unknown route: files");
  // 066-071 put 新建文件夹 / 上传 on the same row as the page heading, so
  // they are handed to the frame as its actions rather than repeated inside
  // the body. The controller lives here so the header buttons and the table
  // rows below share one state.
  const ctl = useFilesController();
  return (
    <PageFrame route={route} actions={<FilesHeaderActions ctl={ctl} />}>
      <FilesPageBody ctl={ctl} />
    </PageFrame>
  );
}
export function BrandKitsPage() {
  const route = routeById("brand-kits");
  if (!route) throw new Error("unknown route: brand-kits");
  return <PageFrame route={route}><BrandKitsBody /></PageFrame>;
}

/** Local BYOK pages. These are additions, not replicas. */
export function LocalProviderSettingsPage() {
  const meta = LOCAL_ROUTES.find((r) => r.id === "local-provider-settings")!;
  return (
    <PageFrame
      route={{
        id: meta.id,
        path: meta.path,
        kind: "local-extension",
        owner: "CORE",
        phase: "M1",
        coverage: "local-design",
        spec: "pages/assets-local.md",
        evidence: [],
        adaptation: "本地扩展页面，非原站复刻",
      }}
    >
      <ProviderSettingsPage />
    </PageFrame>
  );
}

export function LocalStorageSettingsPage() {
  const meta = LOCAL_ROUTES.find((r) => r.id === "local-storage-settings")!;
  return (
    <PageFrame
      route={{
        id: meta.id,
        path: meta.path,
        kind: "local-extension",
        owner: "STORAGE",
        phase: "M1",
        coverage: "local-design",
        spec: "pages/assets-local.md",
        evidence: [],
        adaptation: "本地扩展页面，非原站复刻",
      }}
    >
      <LocalStorageSettingsPageBody />
    </PageFrame>
  );
}

export function LocalJobsPage() {
  const meta = LOCAL_ROUTES.find((r) => r.id === "local-jobs")!;
  return (
    <PageFrame
      route={{
        id: meta.id,
        path: meta.path,
        kind: "local-extension",
        owner: "CORE",
        phase: "M1",
        coverage: "local-design",
        spec: "pages/assets-local.md",
        evidence: [],
        adaptation: "本地扩展页面，非原站复刻",
      }}
    >
      <LocalJobsPageBody />
    </PageFrame>
  );
}
