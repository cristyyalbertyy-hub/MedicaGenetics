import { doc, setDoc } from "https://esm.sh/firebase@12.15.0/firestore";

export function progressDocId(userId, packageId, itemKey, resource) {
  const safeKey = `${itemKey}/${resource}`.replace(/\//g, "__");
  return `${userId}_${packageId}_${safeKey}`;
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {string} packageId
 * @param {string} itemKey  e.g. BG/MP
 * @param {string} resource V | P | I | Q
 * @param {'started'|'completed'} status
 * @param {{ score?: number }} [extra]
 */
export async function recordProgress(
  db,
  userId,
  packageId,
  itemKey,
  resource,
  status,
  extra = {},
) {
  const id = progressDocId(userId, packageId, itemKey, resource);
  await setDoc(
    doc(db, "progress", id),
    {
      user_id: userId,
      package_id: packageId,
      item_key: itemKey,
      resource,
      status,
      ...(extra.score != null ? { score: extra.score } : {}),
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
}
