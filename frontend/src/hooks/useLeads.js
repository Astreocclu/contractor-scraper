import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsApi } from '@/services/api'

// Hook to fetch clients (formerly leads) with filters
export function useClients(params = {}) {
  return useQuery({
    queryKey: ['clients', params],
    queryFn: () => clientsApi.getClients(params),
    staleTime: 30000, // 30 seconds
  })
}

// Backwards compatibility alias
export const useLeads = useClients

// Hook to fetch single client
export function useClient(clientId) {
  return useQuery({
    queryKey: ['client', clientId],
    queryFn: () => clientsApi.getClient(clientId),
    enabled: !!clientId,
  })
}

// Backwards compatibility alias
export const useLead = useClient

// Hook to fetch client stats
export function useClientStats() {
  return useQuery({
    queryKey: ['clientStats'],
    queryFn: () => clientsApi.getStats(),
    staleTime: 60000, // 1 minute
  })
}

// Backwards compatibility alias
export const useLeadStats = useClientStats

// Hook to fetch top clients
export function useTopClients() {
  return useQuery({
    queryKey: ['topClients'],
    queryFn: () => clientsApi.getTopClients(),
    staleTime: 30000,
  })
}

// Backwards compatibility alias
export const useTopLeads = useTopClients

// Hook to fetch clients by tier
export function useClientsByTier(tier) {
  return useQuery({
    queryKey: ['clientsByTier', tier],
    queryFn: () => clientsApi.getByTier(tier),
    enabled: !!tier,
  })
}

// Backwards compatibility alias
export const useLeadsByTier = useClientsByTier

// Hook to fetch permits
export function usePermits(params = {}) {
  return useQuery({
    queryKey: ['permits', params],
    queryFn: () => clientsApi.getPermits(params),
    staleTime: 30000,
  })
}

// Hook to fetch scraper runs
export function useScraperRuns() {
  return useQuery({
    queryKey: ['scraperRuns'],
    queryFn: () => clientsApi.getScraperRuns(),
    staleTime: 60000,
  })
}

// Mutation to mark client as exported
export function useMarkExported() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (clientId) => clientsApi.markExported(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['clientStats'] })
    },
  })
}

// Mutation to mark client as contacted
export function useMarkContacted() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (clientId) => clientsApi.markContacted(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['clientStats'] })
    },
  })
}
