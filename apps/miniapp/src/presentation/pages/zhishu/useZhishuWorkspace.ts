import { useMemo, useState } from "react";

import {
  createZhishuLocalRepository,
  type ZhishuWorkspace,
} from "../../../data/repositories/zhishuLocalRepository";
import { zhishuDemoWorkspace } from "./workspaceView";

export function useZhishuWorkspace() {
  const repository = useMemo(() => createZhishuLocalRepository(), []);
  const [workspace, setWorkspace] = useState<ZhishuWorkspace>(() => {
    const stored = repository.read();
    const empty =
      stored.items.length === 0 &&
      stored.materials.length === 0 &&
      stored.qqMessages.length === 0;
    return empty ? zhishuDemoWorkspace() : stored;
  });

  function update(change: (current: ZhishuWorkspace) => ZhishuWorkspace): void {
    setWorkspace((current) => {
      const next = change(current);
      repository.write(next);
      return next;
    });
  }

  return { workspace, update };
}
