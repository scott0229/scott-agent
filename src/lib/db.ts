import { getCloudflareContext } from "@opennextjs/cloudflare";

export const getDb = async () => {
    const { env } = await getCloudflareContext();
    return env.DB;
};
