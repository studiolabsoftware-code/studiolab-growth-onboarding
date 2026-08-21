# Neverland session-based multi-class discount model

Status: working recommendation  
Context: Neverland Studios session-based pricing on the StudioLAB Core.net legacy platform

## Recommendation

Use a per-student class-count discount curve applied across the full eligible enrolment stack.

This is not a marginal line-item discount. The system does not apply 95% off only the 8th, 9th, or 10th class. The platform selects one discount percentage based on the student's eligible class count, then applies that percentage to all eligible tuition charges for that student.

This fits the legacy platform pricing structure because the platform already supports a `PerStudent` class discount by unit count, with fields from `For2Units` through `For19Units`. The engine counts distinct eligible classes for the student, ignores classes marked `ExcludeFromClassDiscounts`, selects the highest matching unit threshold, and applies that percentage to the relevant auto-tuition/session charge.

The recommended commercial shape is:

| Eligible classes | Discount to enter | Family pays | Commercial intent |
| ---: | ---: | ---: | --- |
| 1 | 0% | 100% | No discount. |
| 2 | 0% | 100% | Remove low-load discounting. |
| 3 | 0% | 100% | Remove low-load discounting. |
| 4 | 0% | 100% | Remove low-load discounting. |
| 5 | 0% | 100% | Remove low-load discounting. |
| 6 | 10% | 90% of total eligible class fees | Equivalent to first five full price plus 6th at 40% of normal fee, when class prices are equal. |
| 7 | 20% | 80% of total eligible class fees | Equivalent to first five full price plus 6th at 40% and 7th at 20%, when class prices are equal. |
| 8 | 29.375% | 70.625% | Equivalent to the 8th class adding 5% of its normal fee. |
| 9 | 36.667% | 63.333% | Keeps the next class adding about 5% of normal fee. |
| 10 | 42.5% | 57.5% | Keeps the next class adding about 5% of normal fee. |
| 11 | 47.273% | 52.727% | Keeps the next class adding about 5% of normal fee. |
| 12 | 51.25% | 48.75% | Keeps the next class adding about 5% of normal fee. |
| 13 | 54.615% | 45.385% | Keeps the next class adding about 5% of normal fee. |
| 14 | 57.5% | 42.5% | Keeps the next class adding about 5% of normal fee. |
| 15 | 60% | 40% | Keeps the next class adding about 5% of normal fee. |
| 16 | 62.188% | 37.812% | Keeps the next class adding about 5% of normal fee. |
| 17 | 64.118% | 35.882% | Keeps the next class adding about 5% of normal fee. |
| 18 | 65.833% | 34.167% | Keeps the next class adding about 5% of normal fee. |
| 19 | 67.368% | 32.632% | Keeps the next class adding about 5% of normal fee. |

## Why this is the cleanest model

The two options supplied are functionally the same at 6 and 7 classes when class prices are equal:

At $170 per class, 7 classes is $1,190 gross. A 20% whole-stack discount gives a payable total of $952. Charging the first five classes at full price, the 6th at 40%, and the 7th at 20% also gives $952.

From 8 classes onward, the business goal is no longer a hard unlimited cap. The goal is a very small additional commitment per extra class. The supplied example uses 5% of the normal class fee, which is $8.50 per extra class when the class price is $170, and about $10 per extra class when the normal class fee is around $200.

The platform cannot natively express "only the 8th class is 95% off" as a marginal-only package rule inside the current class-count discount fields. What it can express cleanly is the equivalent total-stack percentage by class count. That is what the table above provides.

For example, 8 classes at $170 each is $1,360 gross. The platform applies a 29.375% discount to the full $1,360 eligible tuition stack, creating a payable total of $960.50. That happens to produce the same family-facing outcome as saying the 8th class only added $8.50, but the platform calculation is still whole-stack discounting.

## Implementation note for the platform

Enter the recommendation as the season's per-student class discount table:

| Platform field | Value |
| --- | ---: |
| `For2Units` | 0 |
| `For3Units` | 0 |
| `For4Units` | 0 |
| `For5Units` | 0 |
| `For6Units` | 10 |
| `For7Units` | 20 |
| `For8Units` | 29.375 |
| `For9Units` | 36.667 |
| `For10Units` | 42.5 |
| `For11Units` | 47.273 |
| `For12Units` | 51.25 |
| `For13Units` | 54.615 |
| `For14Units` | 57.5 |
| `For15Units` | 60 |
| `For16Units` | 62.188 |
| `For17Units` | 64.118 |
| `For18Units` | 65.833 |
| `For19Units` | 67.368 |

Leave `For1Units` unset because the legacy model starts discount thresholds at 2 units; one class remains undiscounted by default.

## Behaviour to explain to Neverland

This removes the old unlimited-class outcome while still rewarding committed students. Families doing one to five classes pay the normal class fees. At six and seven classes, the discount begins. From the eighth class onward, each extra eligible class adds only a very small amount to the term fee, instead of opening the door to unlimited enrolment with no meaningful extra commitment.

The model should be described as "a high-commitment multi-class discount", not as an unlimited package.

## Marketing direction for Neverland

Use outcome language in public-facing material. Avoid publishing the internal percentage table as the main parent-facing explanation unless Neverland is prepared to explain that the percentages apply to the whole tuition stack.

Recommended wording:

> Multi-class discounts are based on the total number of eligible classes a student takes in the term. Families taking one to five classes pay normal class fees. From six classes onward, the discount increases, and from eight classes onward each extra class only adds a small amount to the term fee.

Short version:

> Our high-commitment multi-class discount rewards dancers who train across a larger weekly schedule, while keeping every class enrolment intentional.

Fee guide wording:

> Once a student reaches a multi-class discount tier, the tier percentage is applied to their eligible tuition total for the term.

Avoid saying:

> Your 8th, 9th and 10th classes are 95% off.

That wording implies a marginal discount on individual class lines. The clearer version is:

> At the higher class-count tiers, the total term fee is structured so each additional eligible class adds only a small amount.
