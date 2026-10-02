import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import { LOCAL_ROUTES } from "@/app/route-manifest";

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

export const FilesPage = page("files");
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
      <LocalPlaceholder summary={meta.summary} />
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
      <LocalPlaceholder summary={meta.summary} />
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
      <LocalPlaceholder summary={meta.summary} />
    </PageFrame>
  );
}

function LocalPlaceholder({ summary }: { summary: string }) {
  return (
    <section className="stack gap-3">
      <p className="text-sm text-foreground">{summary}</p>
      <p className="text-sm text-secondary">
        本页由 M0-T03（本地服务端与钥匙金库）和 M1-T04/M1-T05
        （Provider 适配器、任务队列）填充。在密钥金库落地前不显示任何可输入或可提交的真实控件。
      </p>
    </section>
  );
}
