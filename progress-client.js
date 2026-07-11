import { doc, getDoc, setDoc } from "firebase/firestore";

export const AUTO_RESOURCES = ["V", "P"];
export const MANUAL_RESOURCES = ["I", "Q"];
export const MAX_PROGRESS_LEVEL = 3;

export function progressDocId(userId, packageId, itemKey, resource) {
  const safeKey = `${itemKey}/${resource}`.replace(/\//g, "__");
  return `${userId}_${packageId}_${safeKey}`;
}

export function levelFromWatchCount(watchCount) {
  const n = typeof watchCount === "number" ? watchCount : 0;
  return Math.min(MAX_PROGRESS_LEVEL, Math.max(0, n));
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {string} packageId
 * @param {string} itemKey
 * @param {'V'|'P'} resource
 */
export async function recordWatchComplete(db, userId, packageId, itemKey, resource) {
  const id = progressDocId(userId, packageId, itemKey, resource);
  const ref = doc(db, "progress", id);

  let current = 0;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      current = levelFromWatchCount(snap.data().watch_count);
    }
  } catch {
    current = 0;
  }

  const next = Math.min(MAX_PROGRESS_LEVEL, current + 1);

  await setDoc(
    ref,
    {
      user_id: userId,
      package_id: packageId,
      item_key: itemKey,
      resource,
      tracking: "auto",
      watch_count: next,
      status: next > 0 ? "completed" : "started",
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  return next;
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {string} packageId
 * @param {string} itemKey
 * @param {string} resource
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
  if (AUTO_RESOURCES.includes(resource) && status === "completed") {
    return recordWatchComplete(db, userId, packageId, itemKey, resource);
  }

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
