import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";

/* ==========================================================================
   EDITORS module — Studio, Flows, chat, audiobooks.
   Team invites, member roles and public sharing are excluded by SCOPE.md.
   The four `path: null` entries (Studio editor, Templates, Audio Native,
   Productions, Ads Engine) are deliberately absent: routes.json marks them
   pending-discovery and forbids guessing an upstream URL.
   ========================================================================== */

function page(id: string) {
  const route = routeById(id);
  if (!route) throw new Error(`unknown route: ${id}`);
  return function EditorsPage() {
    return <PageFrame route={route} />;
  };
}

export const StudioPage = page("studio");
export const StudioTemplatesPage = page("studio-templates");
export const FlowsPage = page("flows");
export const FlowEditorPage = page("flow-editor");
export const ChatPage = page("chat");
export const ChatSessionPage = page("chat-session");
export const AudiobooksPage = page("audiobooks");
