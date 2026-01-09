# Issue: "Only 4 Contractors Showing" - Root Cause Analysis

**Date:** 2025-12-08
**Status:** RESOLVED
**Resolution:** `passes_threshold` field not updating when scores change

---

## Summary

The "Find Contractors" page showed only 4 contractors despite 116+ having qualifying scores (50+). The `passes_threshold` boolean field wasn't being recalculated when `trust_score` was updated.

---

## Root Cause

### The Bug

In `contractors/models.py:119-121`, the threshold is calculated in the `save()` method:

```python
def save(self, *args, **kwargs):
    score = self.admin_score_override or self.trust_score
    self.passes_threshold = score >= PASS_THRESHOLD  # Only runs on save()
    super().save(*args, **kwargs)
```

**Problem:** The audit pipeline updates `trust_score` but doesn't always call `save()`. If scores are updated via:
- `.update()` queryset method
- Bulk operations
- Direct field assignment without `.save()`

Then `passes_threshold` stays at its old value (usually `False`).

### Evidence

Database state before fix:
```
Gold 80+: 60 contractors
Silver 65-79: 34 contractors
Bronze 50-64: 22 contractors
passes_threshold=True: 4  ← Should be 116!
```

Example: J Caldwell Custom Pools had `trust_score=95` but `passes_threshold=False`.

---

## Resolution

### Immediate Fix (Applied 2025-12-08)

Re-saved all scored contractors to trigger threshold recalculation:

```bash
cd /home/reid/testhome/contractors
source venv/bin/activate
python3 manage.py shell -c "from contractors.models import Contractor; [c.save() for c in Contractor.objects.filter(trust_score__gt=0)]"
```

**Result:** 4 → 116 passing contractors

### Permanent Fix Needed

The audit code that updates `trust_score` must either:

1. **Call `.save()` after updating scores** (preferred)
2. **Manually update `passes_threshold`** in the same operation
3. **Use a Django signal** to auto-update on `trust_score` change

#### Option 1: Fix in audit code

Find where `trust_score` is set and ensure `.save()` is called:

```python
# BAD - passes_threshold won't update
Contractor.objects.filter(pk=id).update(trust_score=85)

# GOOD - triggers save() logic
contractor = Contractor.objects.get(pk=id)
contractor.trust_score = 85
contractor.save()
```

#### Option 2: Add Django signal

In `contractors/models.py`:

```python
from django.db.models.signals import pre_save
from django.dispatch import receiver

@receiver(pre_save, sender=Contractor)
def update_passes_threshold(sender, instance, **kwargs):
    score = instance.admin_score_override or instance.trust_score
    instance.passes_threshold = score >= PASS_THRESHOLD
```

---

## Files to Check

Look for places that update `trust_score` without calling `save()`:

| File | Purpose |
|------|---------|
| `contractors/services/scoring.py` | Score calculation |
| `contractors/management/commands/audit_contractors.py` | Audit pipeline |
| `services/audit_agent.js` | Node.js audit agent |
| `services/audit_agent_v2.js` | V2 audit agent |

Search pattern:
```bash
grep -r "trust_score" --include="*.py" --include="*.js" | grep -E "update|="
```

---

## Prevention

Add this to `ERRORS.md`:

```
| 2025-12-08 | Audit | Only 4 contractors showing despite 116 qualified | passes_threshold not updated when trust_score changes via .update(). Must call .save() or use signal. |
```

---

## Test After Future Audits

After running audits, verify counts match:

```bash
python3 manage.py shell -c "
from contractors.models import Contractor
scored = Contractor.objects.filter(trust_score__gte=50).count()
passing = Contractor.objects.filter(passes_threshold=True).count()
print(f'Scored >=50: {scored}, passes_threshold=True: {passing}')
if scored != passing:
    print('MISMATCH - run: [c.save() for c in Contractor.objects.filter(trust_score__gt=0)]')
"
```

---

*Document created: 2025-12-08*
*Issue resolved: 2025-12-08 - 112 contractors fixed*
