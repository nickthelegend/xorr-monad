"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the WebGL hero. Next will not let a Server Component opt out of
 * SSR, and a canvas cannot be server-rendered. The page reads fine before it loads.
 */
const Console3D = dynamic(() => import("./device/Console3D").then((m) => m.Console3D), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center">
      <span className="label">loading</span>
    </div>
  ),
});

export function ConsoleStage({ spin }: { spin?: boolean }) {
  return <Console3D spin={spin} />;
}
