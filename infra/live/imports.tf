# What existed before this directory: the zone AJ made with the CLI on 2026-10-14 when the domain's name servers moved
# to this account, with the records it copied from the old zone (the site's names, still pointing at the old
# distribution, and next.overdubstudio.com's delegation). Everything else here is new. The old zone's ACM validation
# CNAMEs (_355b…, _2557…, for the old account's certificate) are left alone, unmanaged: delete them once the old
# certificate is gone (the runbook's teardown).

import {
  to = aws_route53_zone.live
  id = "Z05043651508AY2E6VV6N"
}

import {
  to = aws_route53_record.site["apex_a"]
  id = "Z05043651508AY2E6VV6N_overdubstudio.com_A"
}

import {
  to = aws_route53_record.site["apex_aaaa"]
  id = "Z05043651508AY2E6VV6N_overdubstudio.com_AAAA"
}

import {
  to = aws_route53_record.site["www_a"]
  id = "Z05043651508AY2E6VV6N_www.overdubstudio.com_A"
}

import {
  to = aws_route53_record.site["www_aaaa"]
  id = "Z05043651508AY2E6VV6N_www.overdubstudio.com_AAAA"
}

import {
  to = aws_route53_record.next_delegation
  id = "Z05043651508AY2E6VV6N_next.overdubstudio.com_NS"
}
