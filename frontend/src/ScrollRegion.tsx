import React, { useLayoutEffect, useRef, useState } from "react";
import "./scroll-region.css";

/** A bounded viewport that becomes keyboard-focusable when content overflows. */
export function ScrollRegion({ label, children, className = "", bounded = true, role = "region", ...attributes }: React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  bounded?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ x: false, y: false });
  useLayoutEffect(() => {
    const region = ref.current;
    if (!region) return;
    const check = () => {
      const x = region.scrollWidth > region.clientWidth + 1;
      const y = region.scrollHeight > region.clientHeight + 1;
      setOverflow(previous => previous.x === x && previous.y === y ? previous : { x, y });
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(region);
    if (region.firstElementChild) resize.observe(region.firstElementChild);
    const mutations = new MutationObserver(check);
    mutations.observe(region, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [children]);
  return <div {...attributes} ref={ref} className={`scroll-region ${bounded ? "scroll-region--bounded" : ""} ${overflow.y ? "scroll-region--vertical" : ""} ${className}`} role={role} aria-label={label} tabIndex={overflow.x || overflow.y ? 0 : undefined}>{children}</div>;
}
