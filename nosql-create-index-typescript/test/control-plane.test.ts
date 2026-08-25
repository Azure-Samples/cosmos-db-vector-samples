import { describe, expect, it, vi } from "vitest";
import { cleanupSampleContainers } from "../src/control-plane.js";
import { loadConfigFromEnv } from "../src/config.js";

describe("create-index TypeScript cleanup", () => {
  it("deletes the configured container names", async () => {
    const beginDeleteSqlContainerAndWait = vi.fn().mockResolvedValue(undefined);
    const armClient = {
      sqlResources: { beginDeleteSqlContainerAndWait },
    };
    const config = loadConfigFromEnv({
      AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME: "hotels_diskann",
      AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME:
        "hotels_quantizedflat",
    });

    await cleanupSampleContainers(armClient as never, config);

    expect(beginDeleteSqlContainerAndWait).toHaveBeenCalledTimes(2);
    expect(beginDeleteSqlContainerAndWait.mock.calls.map((call) => call[3])).toEqual([
      "hotels_diskann",
      "hotels_quantizedflat",
    ]);
  });
});
