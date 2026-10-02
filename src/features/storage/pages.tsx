import { PageFrame } from "@/features/shared/PageFrame";
import { routeById, LOCAL_ROUTES } from "@/app/route-manifest";
import { ProviderSettingsPage } from "@/features/core/ProviderSettingsPage";
import { LocalJobsPageBody } from "@/features/core/LocalJobsPage";
import { LocalStorageSettingsPageBody } from "@/features/core/LocalStorageSettingsPage";
import { FilesPage as FilesPageBody } from "@/features/storage/FilesPage";

/* ==========================================================================
   STORAGE + CORE modules.

   Storage: local folders, files, brand kits. The upstream account/workspace
   filters are excluded by SCOPE.md, so there is no owner or member filter
   here — this build is single-user and local.

   The LOCAL_ROUTES pages are BYOK configuration, not part of the upstream
   surface. They are local extensions and are labelled as such on screen.
   ========================================================================== */

function page(id: string) {
  const route = routeById(id);
  if (!route) throw new Error(`unknown route: ${id}`);
  return function StoragePage() {
    return <PageFrame route={route} />;
  };
}

export function FilesPage() {
  const route = routeById("files");
  if (!route) throw new Error("unknown route: files");
  return <PageFrame route={route}><FilesPageBody /></PageFrame>;
}
export const BrandKitsPage = page("brand-kits");

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
