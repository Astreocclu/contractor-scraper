import axios from 'axios'

// Use relative URL to go through Vite proxy (avoids CORS)
const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add any auth headers here if needed
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout')
    } else if (!error.response) {
      console.error('Network error - backend may be offline')
    }
    return Promise.reject(error)
  }
)

// API functions
export const contractorApi = {
  // Get all contractors with optional filters
  getContractors: async (params = {}) => {
    const response = await api.get('/contractors/', { params })
    return response.data
  },

  // Get single contractor by slug
  getContractor: async (slug) => {
    const response = await api.get(`/contractors/${slug}/`)
    return response.data
  },

  // Get stats
  getStats: async () => {
    const response = await api.get('/contractors/stats/')
    return response.data
  },

  // Get verticals
  getVerticals: async () => {
    const response = await api.get('/verticals/')
    return response.data
  },

  // Search contractors
  searchContractors: async (query) => {
    const response = await api.get('/contractors/', {
      params: { search: query, all: true }
    })
    return response.data
  },

  // Run a management command with options
  runCommand: async (command, options = {}) => {
    const response = await api.post('/commands/', { command, options })
    return response.data
  },

  // Get task status
  getTaskStatus: async (taskId) => {
    const response = await api.get('/commands/', { params: { task_id: taskId } })
    return response.data
  },

  // Get all running tasks
  getTasks: async () => {
    const response = await api.get('/commands/')
    return response.data
  },

  // Stop a running task
  stopTask: async (taskId) => {
    const response = await api.delete('/commands/', { params: { task_id: taskId } })
    return response.data
  },
}

export default api
