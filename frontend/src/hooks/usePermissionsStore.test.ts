import { describe, it, expect, beforeEach } from "vitest";
import { usePermissionsStore } from "./usePermissionsStore";

describe("usePermissionsStore", () => {
  beforeEach(() => {
    usePermissionsStore.setState({
      permissions: [
        { id: "p1", name: "P1", description: "D1", granted: false, category: "payment" },
        { id: "p2", name: "P2", description: "D2", granted: true, category: "payment" },
      ],
    });
  });

  it("should toggle a permission", () => {
    const store = usePermissionsStore.getState();
    store.togglePermission("p1");
    
    const updated = usePermissionsStore.getState();
    expect(updated.permissions.find(p => p.id === "p1")?.granted).toBe(true);
  });

  it("should check if all permissions are granted in a category", () => {
    const store = usePermissionsStore.getState();
    expect(store.isAllGranted("payment")).toBe(false);
    
    store.togglePermission("p1");
    expect(usePermissionsStore.getState().isAllGranted("payment")).toBe(true);
  });
});
