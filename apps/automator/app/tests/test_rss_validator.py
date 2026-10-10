"""Tests for Podcast RSS validator module."""

import pytest

from services.rss_validator import PodcastRssValidationError, PodcastRssValidator

VALID_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Sample Podcast</title>
    <link>https://example.com</link>
    <description>A sample podcast for testing.</description>
    <language>ja</language>
    <itunes:category text="Technology"/>
    <itunes:explicit>no</itunes:explicit>
    <itunes:image href="https://example.com/cover.jpg"/>
    <itunes:author>Sample Author</itunes:author>
    <itunes:owner>
      <itunes:name>Sample Owner</itunes:name>
      <itunes:email>owner@example.com</itunes:email>
    </itunes:owner>
    <item>
      <title>Episode 1</title>
      <description>First episode description</description>
      <guid isPermaLink="false">guid-12345</guid>
      <pubDate>Wed, 17 Dec 2025 14:35:58 +0000</pubDate>
      <enclosure url="https://example.com/audio1.mp3" length="12345678" type="audio/mpeg"/>
      <itunes:duration>00:30:00</itunes:duration>
    </item>
  </channel>
</rss>
"""


def test_validator_succeeds_on_valid_xml():
    validator = PodcastRssValidator(strict=True)
    errors = validator.validate(VALID_RSS)
    assert errors == []


def test_validator_fails_on_malformed_xml():
    validator = PodcastRssValidator(strict=False)
    errors = validator.validate("<rss><channel>")
    assert any("XML parse error" in err for err in errors)

    strict_validator = PodcastRssValidator(strict=True)
    with pytest.raises(PodcastRssValidationError):
        strict_validator.validate("<rss><channel>")


def test_validator_catches_missing_channel_tags():
    invalid_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>No other tags</title>
      </channel>
    </rss>
    """
    validator = PodcastRssValidator(strict=False)
    errors = validator.validate(invalid_xml)
    assert any("Channel <description>" in err for err in errors)
    assert any("Channel <link>" in err for err in errors)
    assert any("Channel <language>" in err for err in errors)
    assert any("Channel <itunes:category>" in err for err in errors)
    assert any("Channel <itunes:explicit>" in err for err in errors)
    assert any("Channel <itunes:image>" in err for err in errors)
    assert any("Channel <itunes:owner>" in err for err in errors)
    assert any("Channel <itunes:author>" in err for err in errors)


def test_validator_catches_invalid_item_tags():
    invalid_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
      <channel>
        <title>Podcast</title>
        <link>https://example.com</link>
        <description>Description</description>
        <language>ja</language>
        <itunes:category text="Technology"/>
        <itunes:explicit>no</itunes:explicit>
        <itunes:image href="https://example.com/cover.jpg"/>
        <itunes:author>Author</itunes:author>
        <itunes:owner>
          <itunes:name>Owner</itunes:name>
          <itunes:email>email@example.com</itunes:email>
        </itunes:owner>
        <item>
          <!-- Missing title, guid, enclosure, pubDate -->
          <description>Bad item</description>
        </item>
      </channel>
    </rss>
    """
    validator = PodcastRssValidator(strict=False)
    errors = validator.validate(invalid_xml)
    assert any("Item #1 <title>" in err for err in errors)
    assert any("Item #1 <guid>" in err for err in errors)
    assert any("Item #1 <enclosure>" in err for err in errors)
    assert any("Item #1 <pubDate>" in err for err in errors)


def test_validator_validates_enclosure_attributes():
    invalid_enclosure = VALID_RSS.replace('length="12345678"', 'length="not-a-number"')
    validator = PodcastRssValidator(strict=False)
    errors = validator.validate(invalid_enclosure)
    assert any("Item #1 <enclosure> 'length' attribute must be a non-negative integer" in err for err in errors)
