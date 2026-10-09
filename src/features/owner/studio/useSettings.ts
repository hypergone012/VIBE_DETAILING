import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@astryxdesign/core/Toast';
import { humanError } from '@/api/errors';
import { tenantQueryKey } from '@/features/tenant/TenantRoot';
import { ownerKeys, useOwner } from '../OwnerContext';

export function useSettings() {
  const { slug, api } = useOwner();
  return useQuery({ queryKey: ownerKeys.settings(slug), queryFn: () => api.settings() });
}

/**
 * A settings change: on success refreshes the cabinet settings, the public studio
 * page data (prices, hours, photos) and free slots, and confirms with a toast.
 */
export function useSettingsMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  successMessage: string | ((result: TResult) => string),
) {
  const { slug } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.settings(slug) });
      void queryClient.invalidateQueries({ queryKey: tenantQueryKey(slug) });
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      void queryClient.invalidateQueries({ queryKey: ['owner', slug, 'slots'] });
      showToast({ body: typeof successMessage === 'function' ? successMessage(result) : successMessage });
    },
    onError: (error) => showToast({ body: humanError(error) }),
  });
}
