import { perfxcelSupabase } from "../db/supabase";

let cache = new Map<string, unknown>();
let cacheTime = 0;
const TTL_MS = 5 * 60 * 1000;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (Date.now() - cacheTime > TTL_MS) {
    const { data } = await perfxcelSupabase
      .from("settings")
      .select("setting_key, setting_value");
    if (data) {
      cache = new Map(data.map((r) => [r.setting_key, r.setting_value]));
      cacheTime = Date.now();
    }
  }
  const val = cache.get(key);
  return val !== undefined ? (val as T) : fallback;
}
