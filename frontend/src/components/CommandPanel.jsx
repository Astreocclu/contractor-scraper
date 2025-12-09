import { useState, useEffect } from "react"
import { Play, RefreshCw, Brain, Square, Loader2, Settings2, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { contractorApi } from "@/services/api"
import { useVerticals } from "@/hooks/useContractors"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectOption } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

// Checkbox component (simple inline)
function Checkbox({ checked, onChange, label, id }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-border bg-background"
      />
      <span className="text-sm">{label}</span>
    </label>
  )
}

export function CommandPanel() {
  const queryClient = useQueryClient()
  const { data: verticals } = useVerticals()

  // Track running tasks
  const [runningTasks, setRunningTasks] = useState({})

  // Dialog states
  const [scraperOpen, setScraperOpen] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)

  // Scraper options
  const [scraperOptions, setScraperOptions] = useState({
    limit: 50,
    vertical: '',
    city: '',
    with_reviews: false,
    dry_run: false,
  })

  // Enrich options
  const [enrichOptions, setEnrichOptions] = useState({
    limit: 100,
    yelp_only: false,
    bbb_only: false,
    force: false,
  })

  // Audit options
  const [auditOptions, setAuditOptions] = useState({
    limit: 50,
    skip_ai: false,
  })

  // Poll for task status
  useEffect(() => {
    const runningTaskIds = Object.entries(runningTasks)
      .filter(([_, t]) => t.status === 'running' || t.status === 'starting')
      .map(([id]) => id)

    if (runningTaskIds.length === 0) return

    const interval = setInterval(async () => {
      for (const taskId of runningTaskIds) {
        try {
          const result = await contractorApi.getTaskStatus(taskId)
          if (result.status !== 'running' && result.status !== 'starting') {
            setRunningTasks(prev => ({ ...prev, [taskId]: result }))
            if (result.status === 'completed') {
              toast.success(`${result.command} completed`, {
                description: 'Data has been refreshed'
              })
              queryClient.invalidateQueries({ queryKey: ['contractors'] })
              queryClient.invalidateQueries({ queryKey: ['stats'] })
            } else if (result.status === 'failed') {
              toast.error(`${result.command} failed`, {
                description: result.output?.slice(0, 100)
              })
            } else if (result.status === 'stopped') {
              toast.info(`${result.command} stopped`)
            }
          }
        } catch (e) {
          console.error('Failed to check task status:', e)
        }
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [runningTasks, queryClient])

  // Run a command
  const runCommand = async (command, options) => {
    try {
      const result = await contractorApi.runCommand(command, options)
      setRunningTasks(prev => ({
        ...prev,
        [result.task_id]: { status: 'running', command, options }
      }))
      toast.info(`Started ${command}`, {
        description: `Task ID: ${result.task_id}`
      })
      // Close dialogs
      setScraperOpen(false)
      setEnrichOpen(false)
      setAuditOpen(false)
    } catch (e) {
      if (e.response?.status === 409) {
        toast.warning('Task already running', {
          description: e.response.data.error
        })
      } else {
        toast.error('Failed to start command', {
          description: e.message
        })
      }
    }
  }

  // Stop a task
  const stopTask = async (taskId) => {
    try {
      await contractorApi.stopTask(taskId)
      setRunningTasks(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], status: 'stopped' }
      }))
      toast.info('Task stopped')
    } catch (e) {
      toast.error('Failed to stop task', { description: e.message })
    }
  }

  // Check if a command is running
  const getRunningTask = (command) => {
    return Object.entries(runningTasks).find(
      ([_, t]) => t.command === command && (t.status === 'running' || t.status === 'starting')
    )
  }

  const isRunning = (command) => !!getRunningTask(command)

  // Common cities in DFW
  const cities = [
    'Dallas', 'Fort Worth', 'Arlington', 'Plano', 'Frisco',
    'McKinney', 'Denton', 'Irving', 'Grand Prairie', 'Garland'
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Command Center</CardTitle>
        <CardDescription>Run backend operations with custom options</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Scraper Button */}
        <div className="flex gap-2">
          <Button
            className="flex-1 justify-start gap-2"
            variant="outline"
            onClick={() => setScraperOpen(true)}
            disabled={isRunning('scrape_contractors')}
          >
            {isRunning('scrape_contractors') ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning('scrape_contractors') ? 'Scraping...' : 'Run Scraper'}
          </Button>
          {isRunning('scrape_contractors') && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => {
                const task = getRunningTask('scrape_contractors')
                if (task) stopTask(task[0])
              }}
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Enrich Button */}
        <div className="flex gap-2">
          <Button
            className="flex-1 justify-start gap-2"
            variant="outline"
            onClick={() => setEnrichOpen(true)}
            disabled={isRunning('enrich_contractors')}
          >
            {isRunning('enrich_contractors') ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {isRunning('enrich_contractors') ? 'Enriching...' : 'Enrich Data'}
          </Button>
          {isRunning('enrich_contractors') && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => {
                const task = getRunningTask('enrich_contractors')
                if (task) stopTask(task[0])
              }}
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Audit Button */}
        <div className="flex gap-2">
          <Button
            className="flex-1 justify-start gap-2"
            variant="outline"
            onClick={() => setAuditOpen(true)}
            disabled={isRunning('audit_contractors')}
          >
            {isRunning('audit_contractors') ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            {isRunning('audit_contractors') ? 'Auditing...' : 'Run AI Audit'}
          </Button>
          {isRunning('audit_contractors') && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => {
                const task = getRunningTask('audit_contractors')
                if (task) stopTask(task[0])
              }}
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Score Legend */}
        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground mb-2">Score Tiers</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span>80+ Gold</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <span>65-79 Silver</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-amber-700" />
              <span>50-64 Bronze</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-slate-600" />
              <span>&lt;50 Unranked</span>
            </div>
          </div>
        </div>

        {/* Scraper Dialog */}
        <Dialog open={scraperOpen} onOpenChange={setScraperOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Run Scraper
              </DialogTitle>
              <DialogDescription>
                Scrape contractors from Google Maps (Playwright w/ Puppeteer backup)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Limit</label>
                <Input
                  type="number"
                  value={scraperOptions.limit}
                  onChange={(e) => setScraperOptions(prev => ({ ...prev, limit: parseInt(e.target.value) || 10 }))}
                  min={1}
                  max={500}
                />
                <p className="text-xs text-muted-foreground">Max contractors to scrape per search</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Vertical</label>
                <Select
                  value={scraperOptions.vertical}
                  onChange={(e) => setScraperOptions(prev => ({ ...prev, vertical: e.target.value }))}
                >
                  <SelectOption value="">All Verticals</SelectOption>
                  {verticals?.results?.map((v) => (
                    <SelectOption key={v.slug} value={v.slug}>{v.name}</SelectOption>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">City</label>
                <Select
                  value={scraperOptions.city}
                  onChange={(e) => setScraperOptions(prev => ({ ...prev, city: e.target.value }))}
                >
                  <SelectOption value="">All Cities</SelectOption>
                  {cities.map((city) => (
                    <SelectOption key={city} value={city}>{city}</SelectOption>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Checkbox
                  id="with_reviews"
                  checked={scraperOptions.with_reviews}
                  onChange={(v) => setScraperOptions(prev => ({ ...prev, with_reviews: v }))}
                  label="Fetch reviews for each contractor"
                />
                <Checkbox
                  id="dry_run"
                  checked={scraperOptions.dry_run}
                  onChange={(v) => setScraperOptions(prev => ({ ...prev, dry_run: v }))}
                  label="Dry run (don't save to database)"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setScraperOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={() => runCommand('scrape_contractors', scraperOptions)} className="flex-1">
                <Play className="h-4 w-4 mr-2" />
                Start Scraping
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Enrich Dialog */}
        <Dialog open={enrichOpen} onOpenChange={setEnrichOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Enrich Data
              </DialogTitle>
              <DialogDescription>
                Add BBB and Yelp data to existing contractors
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Limit</label>
                <Input
                  type="number"
                  value={enrichOptions.limit}
                  onChange={(e) => setEnrichOptions(prev => ({ ...prev, limit: parseInt(e.target.value) || 10 }))}
                  min={1}
                  max={1000}
                />
                <p className="text-xs text-muted-foreground">Max contractors to enrich</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Sources</label>
                <div className="flex gap-4">
                  <Checkbox
                    id="yelp_only"
                    checked={enrichOptions.yelp_only}
                    onChange={(v) => setEnrichOptions(prev => ({
                      ...prev,
                      yelp_only: v,
                      bbb_only: v ? false : prev.bbb_only
                    }))}
                    label="Yelp only"
                  />
                  <Checkbox
                    id="bbb_only"
                    checked={enrichOptions.bbb_only}
                    onChange={(v) => setEnrichOptions(prev => ({
                      ...prev,
                      bbb_only: v,
                      yelp_only: v ? false : prev.yelp_only
                    }))}
                    label="BBB only"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave both unchecked for all sources</p>
              </div>

              <div className="space-y-2">
                <Checkbox
                  id="force"
                  checked={enrichOptions.force}
                  onChange={(v) => setEnrichOptions(prev => ({ ...prev, force: v }))}
                  label="Force re-enrich (even if already enriched)"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEnrichOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={() => runCommand('enrich_contractors', enrichOptions)} className="flex-1">
                <RefreshCw className="h-4 w-4 mr-2" />
                Start Enriching
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Audit Dialog */}
        <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Run AI Audit
              </DialogTitle>
              <DialogDescription>
                Analyze contractors with AI and calculate trust scores
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Limit</label>
                <Input
                  type="number"
                  value={auditOptions.limit}
                  onChange={(e) => setAuditOptions(prev => ({ ...prev, limit: parseInt(e.target.value) || 10 }))}
                  min={1}
                  max={500}
                />
                <p className="text-xs text-muted-foreground">Max contractors to audit</p>
              </div>

              <div className="space-y-2">
                <Checkbox
                  id="skip_ai"
                  checked={auditOptions.skip_ai}
                  onChange={(v) => setAuditOptions(prev => ({ ...prev, skip_ai: v }))}
                  label="Skip AI analysis (just calculate scores)"
                />
                <p className="text-xs text-muted-foreground">Faster but less detailed analysis</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAuditOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={() => runCommand('audit_contractors', auditOptions)} className="flex-1">
                <Brain className="h-4 w-4 mr-2" />
                Start Audit
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
