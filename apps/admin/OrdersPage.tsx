import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logAdminAction } from "../../packages/server/src/utils/auditLogger";

// ... existing imports and component logic ...

export default function OrdersPage() {
  const queryClient = useQueryClient();

  const refundMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetch(`/api/orders/${orderId}/refund`, { method: 'POST' });
      if (!response.ok) throw new Error('Refund failed');
      
      // Audit log the sensitive action
      logAdminAction('admin-user-01', 'REFUND_ORDER', orderId, { status: 'success' });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] })
  });

  // ... rest of the component ...
}