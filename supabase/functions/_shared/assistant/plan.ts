/**
 * Mandatory tools per intent: they run on the server before the model is called,
 * and their results are given to the model as tool outputs.
 */
import type { Route } from './router.ts';
import type { ToolName } from './tools.ts';

export interface PlannedCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export function planTools(route: Route): PlannedCall[] {
  const service = route.serviceQuery;
  const serviceArg = service ? { service } : {};
  const dateArg = route.date ? { date: route.date } : {};

  if (route.scope === 'owner') {
    const period = route.period ?? 'today';
    switch (route.intent) {
      case 'stats_money':
      case 'stats_visits':
      case 'stats_completed':
        return [{ name: 'owner_stats', args: { period } }];
      case 'free_slots':
        return [{ name: 'owner_free_slots', args: { ...serviceArg, ...dateArg } }];
      case 'schedule':
        return [{ name: 'owner_schedule', args: { period } }];
      case 'services':
        return [{ name: 'list_services', args: {} }];
      default:
        return [
          { name: 'owner_schedule', args: { period } },
          { name: 'owner_stats', args: { period } },
        ];
    }
  }

  switch (route.intent) {
    case 'next_slot':
      return [{ name: 'next_free_slots', args: { ...serviceArg, ...dateArg } }];
    case 'price':
      return service ? [{ name: 'service_price', args: { service } }] : [{ name: 'list_services', args: {} }];
    case 'services':
      return [{ name: 'list_services', args: {} }];
    case 'my_booking':
      return [{ name: 'my_booking', args: {} }, { name: 'studio_info', args: {} }];
    case 'address':
    case 'hours':
    case 'contacts':
    case 'cancel_policy':
    case 'how_to_book':
      return [{ name: 'studio_info', args: {} }];
    default:
      return [
        { name: 'studio_info', args: {} },
        { name: 'list_services', args: {} },
      ];
  }
}
