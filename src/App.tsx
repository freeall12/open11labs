import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "@/app/router";

/**
 * Root. The app is a real multi-page application: routes come from
 * specs/routes.json, and no URL other than /app/home renders the home page.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
