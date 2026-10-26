import { API_VERSION, CleanerSpec } from './model';

export const recipes = [
  {
    name: 'completed-jobs',
    title: 'Completed jobs',
    category: 'Workloads',
    description: 'Find Jobs that have finished successfully.',
    selector: {
      group: 'batch',
      version: 'v1',
      kind: 'Job',
      evaluate: `function evaluate(obj)
  if obj.status ~= nil and obj.status.conditions ~= nil then
    for _, condition in ipairs(obj.status.conditions) do
      if condition.type == "Complete" and condition.status == "True" then
        return { matching = true, message = "Job completed successfully" }
      end
    end
  end
  return { matching = false }
end`,
    },
  },
  {
    name: 'failed-pods',
    title: 'Failed pods',
    category: 'Workloads',
    description: 'Find Pods in the Failed phase for investigation.',
    selector: {
      group: '',
      version: 'v1',
      kind: 'Pod',
      evaluate: `function evaluate(obj)
  local failed = obj.status ~= nil and obj.status.phase == "Failed"
  return { matching = failed, message = "Pod is in the Failed phase" }
end`,
    },
  },
  {
    name: 'unavailable-deployments',
    title: 'Unavailable deployments',
    category: 'Health',
    description: 'Find Deployments with fewer available replicas than desired.',
    selector: {
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      evaluate: `function evaluate(obj)
  local desired = obj.spec.replicas or 1
  local available = 0
  if obj.status ~= nil then available = obj.status.availableReplicas or 0 end
  return { matching = available < desired, message = "Deployment has unavailable replicas" }
end`,
    },
  },
];

export function recipeObject(recipe = recipes[0]) {
  return {
    apiVersion: API_VERSION,
    kind: 'Cleaner',
    metadata: { name: recipe.name },
    spec: {
      action: 'Scan',
      schedule: '0 * * * *',
      resourcePolicySet: { resourceSelectors: [{ ...recipe.selector, namespace: 'default' }] },
      notifications: [{ name: 'report', type: 'CleanerReport' }],
    } satisfies CleanerSpec,
  };
}
