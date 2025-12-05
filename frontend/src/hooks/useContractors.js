import { useQuery } from '@tanstack/react-query'
import { contractorApi } from '@/services/api'

export function useContractors(params = {}) {
  return useQuery({
    queryKey: ['contractors', params],
    queryFn: () => contractorApi.getContractors(params),
    staleTime: 30000, // 30 seconds
  })
}

export function useContractor(slug) {
  return useQuery({
    queryKey: ['contractor', slug],
    queryFn: () => contractorApi.getContractor(slug),
    enabled: !!slug,
  })
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => contractorApi.getStats(),
    staleTime: 60000, // 1 minute
  })
}

export function useVerticals() {
  return useQuery({
    queryKey: ['verticals'],
    queryFn: () => contractorApi.getVerticals(),
    staleTime: 300000, // 5 minutes
  })
}
