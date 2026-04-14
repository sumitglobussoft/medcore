"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { Plus, Package, Search } from "lucide-react";

interface InventoryItem {
  id: string;
  batchNumber: string;
  quantity: number;
  unitCost?: number;
  sellingPrice?: number;
  expiryDate: string;
  supplier?: string | null;
  location?: string | null;
  reorderLevel?: number | null;
  medicine: { id: string; name: string; genericName?: string | null };
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  createdAt: string;
  notes?: string | null;
  inventory?: { batchNumber: string; medicine: { name: string } };
}

interface Medicine {
  id: string;
  name: string;
  genericName?: string | null;
}

type Tab = "inventory" | "low" | "expiring" | "movements";

const MOVEMENT_COLORS: Record<string, string> = {
  PURCHASE: "bg-green-100 text-green-700",
  DISPENSED: "bg-blue-100 text-blue-700",
  EXPIRED: "bg-red-100 text-red-700",
  ADJUSTMENT: "bg-yellow-100 text-yellow-700",
  RETURN: "bg-purple-100 text-purple-700",
  DAMAGED: "bg-gray-100 text-gray-700",
};

export default function PharmacyPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>("inventory");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const canManage = user?.role === "ADMIN" || user?.role === "RECEPTION";

  useEffect(() => {
    if (tab === "movements") loadMovements();
    else loadInventory();
  }, [tab, search]);

  async function loadInventory() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (tab === "low") params.set("lowStock", "true");
      let endpoint = `/pharmacy/inventory?${params.toString()}`;
      if (tab === "expiring") {
        endpoint = `/pharmacy/inventory/expiring?days=30`;
      }
      const res = await api.get<{ data: InventoryItem[] }>(endpoint);
      setItems(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function loadMovements() {
    setLoading(true);
    try {
      const res = await api.get<{ data: Movement[] }>(
        "/pharmacy/movements?limit=100"
      );
      setMovements(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  function qtyColor(item: InventoryItem): string {
    if (item.quantity === 0) return "text-red-600 font-semibold";
    if (item.reorderLevel && item.quantity <= item.reorderLevel)
      return "text-orange-600 font-semibold";
    return "text-green-700";
  }

  function expiryColor(exp: string): string {
    const days = (new Date(exp).getTime() - Date.now()) / (86400 * 1000);
    if (days < 0) return "text-red-700 font-semibold";
    if (days < 30) return "text-orange-600 font-semibold";
    return "text-gray-700";
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      tab === t
        ? "bg-primary text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Package className="text-primary" /> Pharmacy
          </h1>
          <p className="text-sm text-gray-500">Inventory management</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            <Plus size={16} /> Add Stock
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setTab("inventory")} className={tabClass("inventory")}>
          Inventory
        </button>
        <button onClick={() => setTab("low")} className={tabClass("low")}>
          Low Stock
        </button>
        <button onClick={() => setTab("expiring")} className={tabClass("expiring")}>
          Expiring Soon
        </button>
        <button onClick={() => setTab("movements")} className={tabClass("movements")}>
          Movements
        </button>
      </div>

      {tab !== "movements" && (
        <div className="mb-4 relative max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            placeholder="Search medicines or batches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 pl-9 text-sm"
          />
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : tab === "movements" ? (
          movements.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No movements.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Medicine</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-sm">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_COLORS[m.type] || "bg-gray-100 text-gray-700"}`}
                      >
                        {m.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {m.inventory?.medicine.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {m.inventory?.batchNumber || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm">{m.quantity}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {m.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No inventory items.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-4 py-3">Medicine</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Reorder</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{i.medicine.name}</p>
                    {i.medicine.genericName && (
                      <p className="text-xs text-gray-500">
                        {i.medicine.genericName}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{i.batchNumber}</td>
                  <td className={`px-4 py-3 text-sm ${qtyColor(i)}`}>
                    {i.quantity}
                  </td>
                  <td className={`px-4 py-3 text-sm ${expiryColor(i.expiryDate)}`}>
                    {new Date(i.expiryDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {i.sellingPrice
                      ? `₹${i.sellingPrice.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{i.location || "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    {i.reorderLevel ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddStockModal onClose={() => setShowAdd(false)} onSaved={loadInventory} />
      )}
    </div>
  );
}

function AddStockModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [medSearch, setMedSearch] = useState("");
  const [medResults, setMedResults] = useState<Medicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [form, setForm] = useState({
    batchNumber: "",
    quantity: "",
    unitCost: "",
    sellingPrice: "",
    expiryDate: "",
    supplier: "",
    location: "",
    reorderLevel: "",
  });

  useEffect(() => {
    if (medSearch.length < 2) {
      setMedResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: Medicine[] }>(
          `/medicines?search=${encodeURIComponent(medSearch)}`
        );
        setMedResults(res.data);
      } catch {
        setMedResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [medSearch]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMed) return alert("Select a medicine");
    try {
      await api.post("/pharmacy/inventory", {
        medicineId: selectedMed.id,
        batchNumber: form.batchNumber,
        quantity: parseInt(form.quantity),
        unitCost: form.unitCost ? parseFloat(form.unitCost) : undefined,
        sellingPrice: form.sellingPrice
          ? parseFloat(form.sellingPrice)
          : undefined,
        expiryDate: form.expiryDate,
        supplier: form.supplier || undefined,
        location: form.location || undefined,
        reorderLevel: form.reorderLevel
          ? parseInt(form.reorderLevel)
          : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add stock");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Add Stock</h2>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Medicine</label>
            {selectedMed ? (
              <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                <span>{selectedMed.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedMed(null)}
                  className="text-xs text-red-600"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  placeholder="Search medicines"
                  value={medSearch}
                  onChange={(e) => setMedSearch(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
                {medResults.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-white shadow-sm">
                    {medResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedMed(m);
                          setMedResults([]);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Batch #</label>
              <input
                required
                value={form.batchNumber}
                onChange={(e) =>
                  setForm({ ...form, batchNumber: e.target.value })
                }
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Quantity</label>
              <input
                required
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Unit Cost</label>
              <input
                type="number"
                step="0.01"
                value={form.unitCost}
                onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Selling Price
              </label>
              <input
                type="number"
                step="0.01"
                value={form.sellingPrice}
                onChange={(e) =>
                  setForm({ ...form, sellingPrice: e.target.value })
                }
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Expiry Date
              </label>
              <input
                required
                type="date"
                value={form.expiryDate}
                onChange={(e) =>
                  setForm({ ...form, expiryDate: e.target.value })
                }
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Supplier</label>
              <input
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Location</label>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Reorder Level
              </label>
              <input
                type="number"
                value={form.reorderLevel}
                onChange={(e) =>
                  setForm({ ...form, reorderLevel: e.target.value })
                }
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Add Stock
          </button>
        </div>
      </form>
    </div>
  );
}
