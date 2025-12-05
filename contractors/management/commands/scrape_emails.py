from django.core.management.base import BaseCommand
from contractors.models import Contractor
import requests
from bs4 import BeautifulSoup
import re
import time
from urllib.parse import urljoin


class Command(BaseCommand):
    help = 'Scrape emails from contractor websites'

    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }

    # Pages likely to have contact info
    CONTACT_PAGES = ['contact', 'contact-us', 'about', 'about-us']

    # Emails to ignore (generic/spam traps)
    IGNORED_EMAILS = {
        'example@example.com', 'test@test.com', 'email@domain.com',
        'your@email.com', 'info@example.com', 'name@domain.com'
    }

    # Domains to ignore (not real emails)
    IGNORED_DOMAINS = {
        'sentry.io', 'wixpress.com', 'example.com', 'domain.com',
        'yoursite.com', 'website.com', 'email.com'
    }

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, help='Limit number of contractors')
        parser.add_argument('--force', action='store_true', help='Re-scrape even if email exists')
        parser.add_argument('--delay', type=float, default=1.5, help='Delay between requests (default: 1.5s)')
        parser.add_argument('--deep', action='store_true', help='Also scrape /contact and /about pages')
        parser.add_argument('--dry-run', action='store_true', help='Show what would be scraped without saving')

    def extract_emails_from_html(self, html, base_url=None):
        """Extract emails from HTML content."""
        emails = set()
        soup = BeautifulSoup(html, 'html.parser')

        # Method 1: Mailto links (highest accuracy)
        for link in soup.select('a[href^="mailto:"]'):
            href = link.get('href', '')
            email = href.replace('mailto:', '').split('?')[0].strip().lower()
            if self.is_valid_email(email):
                emails.add(email)

        # Method 2: Regex on visible text
        text = soup.get_text()
        pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        for email in re.findall(pattern, text):
            email = email.lower()
            if self.is_valid_email(email):
                emails.add(email)

        return emails

    def is_valid_email(self, email):
        """Filter out invalid/junk emails."""
        if not email or '@' not in email:
            return False
        if email in self.IGNORED_EMAILS:
            return False
        domain = email.split('@')[1]
        if domain in self.IGNORED_DOMAINS:
            return False
        # Ignore very long emails (usually encoded junk)
        if len(email) > 60:
            return False
        # Ignore emails with too many dots (often encoded)
        if email.count('.') > 4:
            return False
        # Ignore emails that have numbers in domain (often concatenated junk)
        if re.search(r'\d{3,}', domain):
            return False
        # Ignore emails starting with % (URL encoded junk)
        if email.startswith('%'):
            return False
        # Ignore emails with weird characters
        if any(c in email for c in ['request', 'follow', 'pmemailhello']):
            return False
        return True

    def scrape_url(self, url, timeout=10):
        """Fetch a URL and return HTML content."""
        try:
            response = requests.get(url, headers=self.HEADERS, timeout=timeout, allow_redirects=True)
            if response.status_code == 200:
                return response.text
        except Exception:
            pass
        return None

    def scrape_contractor(self, contractor, deep=False):
        """Scrape emails from a contractor's website."""
        url = contractor.website
        if not url or 'http' not in url:
            return set()

        # Ensure URL has scheme
        if not url.startswith('http'):
            url = 'https://' + url

        all_emails = set()

        # Scrape main page
        html = self.scrape_url(url)
        if html:
            all_emails.update(self.extract_emails_from_html(html, url))

        # Optionally scrape contact/about pages
        if deep and html:
            for page in self.CONTACT_PAGES:
                # Try both with and without trailing slash
                for suffix in [f'/{page}', f'/{page}/', f'/{page}.html']:
                    page_url = urljoin(url.rstrip('/') + '/', suffix.lstrip('/'))
                    page_html = self.scrape_url(page_url)
                    if page_html:
                        all_emails.update(self.extract_emails_from_html(page_html, page_url))
                        break  # Found this contact page, move to next
                time.sleep(0.5)  # Brief delay between subpages

        return all_emails

    def handle(self, *args, **options):
        self.stdout.write('=== SCRAPING CONTRACTOR EMAILS ===\n')

        # Build queryset
        contractors = Contractor.objects.filter(
            is_active=True
        ).exclude(
            website__isnull=True
        ).exclude(
            website=''
        )

        if not options['force']:
            # Only scrape contractors without email
            contractors = contractors.filter(email__isnull=True) | contractors.filter(email='')

        if options['limit']:
            contractors = contractors[:options['limit']]

        count = contractors.count()
        self.stdout.write(f"Found {count} contractors with websites to scrape\n")

        if count == 0:
            self.stdout.write('No contractors need email scraping. Use --force to re-scrape.\n')
            return

        delay = options['delay']
        deep = options['deep']
        dry_run = options['dry_run']

        if deep:
            self.stdout.write('Deep mode: Will also check /contact and /about pages\n')
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN: Not saving any changes\n'))

        found_count = 0
        failed_count = 0

        for i, c in enumerate(contractors, 1):
            self.stdout.write(f"\n[{i}/{count}] {c.business_name}")
            self.stdout.write(f"  URL: {c.website}")

            try:
                emails = self.scrape_contractor(c, deep=deep)

                if emails:
                    # Pick the best email (prefer info@, contact@, or shortest)
                    email_list = sorted(emails, key=lambda e: (
                        0 if e.startswith('info@') else
                        1 if e.startswith('contact@') else
                        2 if e.startswith('sales@') else
                        3,
                        len(e)
                    ))
                    best_email = email_list[0]

                    self.stdout.write(self.style.SUCCESS(f"  Found: {best_email}"))
                    if len(emails) > 1:
                        self.stdout.write(f"  Also found: {', '.join(email_list[1:])}")

                    if not dry_run:
                        c.email = best_email
                        c.save(update_fields=['email'])

                    found_count += 1
                else:
                    self.stdout.write(self.style.WARNING("  No email found"))
                    failed_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f"  Error: {e}"))
                failed_count += 1

            time.sleep(delay)

        # Summary
        self.stdout.write('\n' + '='*50)
        self.stdout.write(self.style.SUCCESS(f'Emails found: {found_count}'))
        self.stdout.write(self.style.WARNING(f'No email found: {failed_count}'))
        self.stdout.write(f'Success rate: {found_count/count*100:.1f}%' if count else '')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN - no changes saved. Remove --dry-run to save.'))
