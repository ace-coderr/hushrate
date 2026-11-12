import { useEffect, useRef } from "react";
import { Footer, Nav, TabNav } from "./components/Layout";
import { useRoute } from "./lib/store";
import { Landing } from "./pages/Landing";
import { Desk } from "./pages/Desk";
import { Sites } from "./pages/Sites";
import { WhatIf } from "./pages/WhatIf";
import { Receipts } from "./pages/Receipts";
import { Proof } from "./pages/Proof";
import { Docs } from "./pages/Docs";
import { Settings } from "./pages/Settings";

const TITLES: Record<string, string> = {
  "/": "Hushrate · run when the grid pays", "/desk": "Desk · Hushrate", "/sites": "Sites · Hushrate", "/whatif": "What-if · Hushrate",
  "/receipts": "Receipts · Hushrate", "/proof": "Proof · Hushrate", "/docs": "Docs · Hushrate", "/settings": "Settings · Hushrate",
};

export function App() {
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  useEffect(() => { document.title = TITLES[route]; }, [route]);
  const Page = { "/": Landing, "/desk": Desk, "/sites": Sites, "/whatif": WhatIf, "/receipts": Receipts, "/proof": Proof, "/docs": Docs, "/settings": Settings }[route];
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }}>Skip to content</a>
      <Nav route={route} />
      <TabNav route={route} />
      <main id="main" ref={main} tabIndex={-1} className="page" key={route}>
        <Page />
      </main>
      <Footer />
    </>
  );
}
