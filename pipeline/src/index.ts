import "dotenv/config";
import express from "express";
import cors from "cors";
import { getConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { router } from "./routes/index.js";

const config = getConfig();
const app = express();

app.use(cors());
app.use(express.json());
app.use("/api", router);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bite-right-pipeline" });
});

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "pipeline server started");
});
