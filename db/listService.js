import { Trader } from "./models/Trader.js";
import { TraderList } from "./models/TraderList.js";

export async function createList(name) {
  return TraderList.create({ name: name.trim() });
}

export async function renameList(id, name) {
  return TraderList.findByIdAndUpdate(id, { $set: { name: name.trim() } }, { returnDocument: "after" });
}

/** Deletes a list and pulls it out of every trader currently tagged with it - no trader is ever left referencing a dangling listId. */
export async function deleteList(id) {
  await Trader.updateMany({ listIds: id }, { $pull: { listIds: id } });
  await TraderList.deleteOne({ _id: id });
}

/** Bulk-tag: adds this listId to every given address's listIds (no-op for ones already tagged). */
export async function addTradersToList(listId, addresses) {
  const result = await Trader.updateMany({ address: { $in: addresses } }, { $addToSet: { listIds: listId } });
  return result.modifiedCount || 0;
}

/** Bulk-untag. */
export async function removeTradersFromList(listId, addresses) {
  const result = await Trader.updateMany({ address: { $in: addresses } }, { $pull: { listIds: listId } });
  return result.modifiedCount || 0;
}

/** Every list, with how many traders are currently tagged into each - for the filter dropdown / manage-lists menu. */
export async function listAllWithCounts() {
  const [lists, counts] = await Promise.all([
    TraderList.find({}).sort({ createdAt: 1 }).lean(),
    Trader.aggregate([{ $unwind: "$listIds" }, { $group: { _id: "$listIds", count: { $sum: 1 } } }]),
  ]);
  const countById = new Map(counts.map((c) => [String(c._id), c.count]));
  return lists.map((l) => ({ ...l, memberCount: countById.get(String(l._id)) || 0 }));
}
