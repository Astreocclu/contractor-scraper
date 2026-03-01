import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { faithApi } from '@/services/api'

export function useFaithStats() {
  return useQuery({
    queryKey: ['faithStats'],
    queryFn: () => faithApi.getStats(),
    staleTime: 60000,
  })
}

export function useFaithCompanies(params = {}, options = {}) {
  const { enabled = true } = options

  return useQuery({
    queryKey: ['faithCompanies', params],
    queryFn: () => faithApi.getCompanies(params),
    staleTime: 30000,
    enabled,
  })
}

export function useFaithCompany(ticker) {
  return useQuery({
    queryKey: ['faithCompany', ticker],
    queryFn: () => faithApi.getCompany(ticker),
    enabled: !!ticker,
  })
}

export function useFaithPortfolio() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => faithApi.getPortfolio(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faithStats'] })
      queryClient.invalidateQueries({ queryKey: ['faithCompanies'] })
    },
  })
}

export function useRescoreFaithCompany() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ticker, payload = {} }) => faithApi.rescoreCompany(ticker, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faithStats'] })
      queryClient.invalidateQueries({ queryKey: ['faithCompanies'] })
      queryClient.invalidateQueries({ queryKey: ['faithCompany'] })
    },
  })
}
