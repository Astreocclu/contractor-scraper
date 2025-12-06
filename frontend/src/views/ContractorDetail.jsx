import { Copy, Phone, Mail, Globe, MapPin, CheckCircle, XCircle, AlertTriangle, Star, Shield, Clock, Award, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { TrustScoreBadge } from "@/components/TrustScoreBadge"
import { TierIcon } from "@/components/TierIcon"
import { useContractor } from "@/hooks/useContractors"
import { cn, formatPhone } from "@/lib/utils"

function ScoreBreakdownItem({ label, score, maxScore, icon: Icon }) {
  const percentage = (score / maxScore) * 100

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span>{label}</span>
        </div>
        <span className="font-medium">{score}/{maxScore}</span>
      </div>
      <Progress
        value={percentage}
        className="h-2"
        indicatorClassName={cn(
          percentage >= 80 ? "bg-green-500" :
          percentage >= 50 ? "bg-yellow-500" : "bg-red-500"
        )}
      />
    </div>
  )
}

function ContactButton({ icon: Icon, label, value, onClick }) {
  if (!value) return null

  return (
    <Button
      variant="outline"
      className="w-full justify-between gap-2"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="truncate">{label}</span>
      </div>
      <Copy className="h-4 w-4 text-muted-foreground" />
    </Button>
  )
}

export function ContractorDetailModal({ contractor: initialContractor, open, onOpenChange }) {
  // Fetch full contractor details when modal opens
  const { data: fullContractor, isLoading } = useContractor(initialContractor?.slug)

  // Use full contractor data if available, fall back to initial data
  const contractor = fullContractor || initialContractor

  if (!initialContractor) return null

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  const redFlags = contractor?.ai_red_flags || []
  const hasRedFlags = redFlags.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-xl">
                {contractor?.business_name || <Skeleton className="h-6 w-48" />}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-1">
                <MapPin className="h-4 w-4" />
                {contractor?.city}, {contractor?.state || 'TX'}
              </DialogDescription>
            </div>
            <TierIcon tier={contractor?.tier} />
          </div>
        </DialogHeader>

        {/* Score Header */}
        <div className={cn(
          "flex items-center justify-between p-4 rounded-lg border",
          contractor?.passes_threshold
            ? "bg-green-500/10 border-green-500/20"
            : "bg-red-500/10 border-red-500/20"
        )}>
          <div className="flex items-center gap-4">
            <TrustScoreBadge score={contractor?.trust_score} size="lg" />
            <div>
              <div className="text-lg font-semibold">
                {contractor?.passes_threshold ? "QUALIFIED" : "NOT QUALIFIED"}
              </div>
              <div className="text-sm text-muted-foreground">
                Trust Score: {contractor?.trust_score || 0}/100
              </div>
            </div>
          </div>
          {contractor?.passes_threshold ? (
            <CheckCircle className="h-12 w-12 text-green-500" />
          ) : (
            <XCircle className="h-12 w-12 text-red-500" />
          )}
        </div>

        {/* Score Breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <ScoreBreakdownItem
                  label="Verification"
                  score={contractor?.verification_score || 0}
                  maxScore={25}
                  icon={Shield}
                />
                <ScoreBreakdownItem
                  label="Reputation"
                  score={contractor?.reputation_score || 0}
                  maxScore={35}
                  icon={Star}
                />
                <ScoreBreakdownItem
                  label="Credibility"
                  score={contractor?.credibility_score || 0}
                  maxScore={25}
                  icon={Clock}
                />
                <ScoreBreakdownItem
                  label="Bonus Points"
                  score={contractor?.bonus_score || 0}
                  maxScore={15}
                  icon={Award}
                />
                {contractor?.red_flag_score > 0 && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-sm text-red-500">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Red Flag Deductions</span>
                      </div>
                      <span className="font-medium">-{contractor?.red_flag_score}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Google Reviews */}
        {contractor?.google_rating && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Google Reviews</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-2xl font-bold">{contractor?.google_rating}</span>
                </div>
                <div className="text-muted-foreground">
                  {contractor?.google_review_count} reviews
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Analysis */}
        {contractor?.ai_summary && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                AI Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {contractor?.ai_summary}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Red Flags */}
        {hasRedFlags && (
          <Card className="border-red-500/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-red-500">
                <AlertTriangle className="h-4 w-4" />
                Red Flags ({redFlags.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {redFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>
                      {typeof flag === 'string' ? flag : flag.description || JSON.stringify(flag)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Contact Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ContactButton
              icon={Phone}
              label={formatPhone(contractor?.phone) || contractor?.phone}
              value={contractor?.phone}
              onClick={() => copyToClipboard(contractor?.phone)}
            />
            <ContactButton
              icon={Mail}
              label={contractor?.email}
              value={contractor?.email}
              onClick={() => copyToClipboard(contractor?.email)}
            />
            <ContactButton
              icon={Globe}
              label={contractor?.website?.replace(/^https?:\/\//, '').slice(0, 40)}
              value={contractor?.website}
              onClick={() => copyToClipboard(contractor?.website)}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {contractor?.website && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(contractor?.website, '_blank')}
            >
              <Globe className="h-4 w-4 mr-2" />
              Visit Website
            </Button>
          )}
          {contractor?.phone && (
            <Button
              variant="default"
              className="flex-1"
              onClick={() => window.open(`tel:${contractor?.phone}`, '_blank')}
            >
              <Phone className="h-4 w-4 mr-2" />
              Call Now
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
