import { useLayoutEffect, useRef } from "react";

export default function CertificateWorkspace({ children }) {
  const workspaceRef = useRef(null);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const toolbar = workspace?.querySelector(
      ":scope > .cert-toolbar"
    );

    if (!workspace || !toolbar) return;

    function measureToolbar() {
      workspace.style.setProperty(
        "--cert-toolbar-height",
        `${Math.ceil(toolbar.getBoundingClientRect().height)}px`
      );
    }

    measureToolbar();

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureToolbar);

    observer?.observe(toolbar);
    window.addEventListener("resize", measureToolbar);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureToolbar);
    };
  }, []);

  return (
    <section
      ref={workspaceRef}
      className="cert-editor-workspace"
      aria-label="Certificate layout editor"
    >
      {children}
    </section>
  );
}