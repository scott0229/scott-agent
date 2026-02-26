import { getCloudflareContext } from "@opennextjs/cloudflare";

export const getDb = async (group?: string) => {
    const { env } = await getCloudflareContext();
    if (group === 'scott') return env.DB_SCOTT;
    return env.DB;
};
