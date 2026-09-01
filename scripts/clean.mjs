import { rm } from "node:fs/promises";
await rm("packages/core/dist", { recursive: true, force: true });
await rm("packages/react/dist", { recursive: true, force: true });
