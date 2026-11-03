"""Podcast RSS feed validation module for Apple Podcasts and general RSS 2.0 specifications."""

from __future__ import annotations

import email.utils
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

# XML Namespaces used in Podcast RSS feeds
NAMESPACES = {
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}

VALID_EXPLICIT_VALUES = {"yes", "no", "clean", "true", "false"}
DURATION_REGEX = re.compile(r"^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$|^\d+$")


class PodcastRssValidationError(Exception):
    """Raised when RSS XML fails podcast specification requirements."""

    def __init__(self, errors: Sequence[str]) -> None:
        """Initialize validation error.

        Args:
            errors: Sequence of validation error messages.
        """
        self.errors = list(errors)
        super().__init__(f"Podcast RSS validation failed with {len(self.errors)} error(s): " + "; ".join(self.errors))


@dataclass(frozen=True)
class PodcastRssValidator:
    """Validates RSS feed XML against Apple Podcasts and RSS 2.0 requirements."""

    strict: bool = True

    def validate(self, xml_content: str | bytes) -> list[str]:
        """Validate podcast RSS XML content and return list of error messages.

        If `strict` is True and there are errors, raises `PodcastRssValidationError`.
        """
        errors: list[str] = []

        if isinstance(xml_content, bytes):
            try:
                xml_text = xml_content.decode("utf-8")
            except UnicodeDecodeError as exc:
                errors.append(f"Invalid UTF-8 encoding: {exc}")
                if self.strict:
                    raise PodcastRssValidationError(errors) from exc
                return errors
        else:
            xml_text = xml_content

        try:
            root = ET.fromstring(xml_text)  # noqa: S314
        except ET.ParseError as exc:
            errors.append(f"XML parse error: {exc}")
            if self.strict:
                raise PodcastRssValidationError(errors) from exc
            return errors

        if root.tag != "rss":
            errors.append(f"Root element must be <rss>, got <{root.tag}>")
            if self.strict:
                raise PodcastRssValidationError(errors)
            return errors

        version = root.attrib.get("version")
        if version != "2.0":
            errors.append(f"RSS version must be '2.0', got '{version}'")

        channel = root.find("channel")
        if channel is None:
            errors.append("Missing <channel> element inside <rss>")
            if self.strict:
                raise PodcastRssValidationError(errors)
            return errors

        # Validate channel-level elements
        self._validate_channel(channel, errors)

        # Validate item-level elements
        items = channel.findall("item")
        for idx, item in enumerate(items, start=1):
            self._validate_item(item, idx, errors)

        if errors and self.strict:
            raise PodcastRssValidationError(errors)

        return errors

    def _validate_channel(self, channel: ET.Element, errors: list[str]) -> None:
        title = channel.findtext("title")
        if not title or not title.strip():
            errors.append("Channel <title> is required and cannot be empty")

        description = channel.findtext("description")
        if not description or not description.strip():
            errors.append("Channel <description> is required and cannot be empty")

        link = channel.findtext("link")
        if not link or not link.strip():
            errors.append("Channel <link> is required and cannot be empty")

        language = channel.findtext("language")
        if not language or not language.strip():
            errors.append("Channel <language> is required and cannot be empty")

        # itunes:category
        category_elem = channel.find("itunes:category", NAMESPACES)
        if category_elem is None or not category_elem.attrib.get("text", "").strip():
            errors.append("Channel <itunes:category> is required with a non-empty 'text' attribute")

        # itunes:explicit
        explicit = channel.findtext("itunes:explicit", namespaces=NAMESPACES)
        if not explicit or explicit.strip().lower() not in VALID_EXPLICIT_VALUES:
            errors.append(f"Channel <itunes:explicit> must be one of {sorted(VALID_EXPLICIT_VALUES)}, got '{explicit}'")

        # itunes:image
        image_elem = channel.find("itunes:image", NAMESPACES)
        if image_elem is None or not image_elem.attrib.get("href", "").strip():
            errors.append("Channel <itunes:image> is required with a non-empty 'href' attribute")

        # itunes:owner (name & email)
        owner_elem = channel.find("itunes:owner", NAMESPACES)
        if owner_elem is None:
            errors.append("Channel <itunes:owner> is required")
        else:
            owner_name = owner_elem.findtext("itunes:name", namespaces=NAMESPACES)
            owner_email = owner_elem.findtext("itunes:email", namespaces=NAMESPACES)
            if not owner_name or not owner_name.strip():
                errors.append("Channel <itunes:owner> must include a non-empty <itunes:name>")
            if not owner_email or not owner_email.strip():
                errors.append("Channel <itunes:owner> must include a non-empty <itunes:email>")

        # itunes:author
        author = channel.findtext("itunes:author", namespaces=NAMESPACES)
        if not author or not author.strip():
            errors.append("Channel <itunes:author> is required and cannot be empty")

    def _validate_item(self, item: ET.Element, idx: int, errors: list[str]) -> None:
        title = item.findtext("title")
        if not title or not title.strip():
            errors.append(f"Item #{idx} <title> is required and cannot be empty")

        guid_elem = item.find("guid")
        if guid_elem is None or not (guid_elem.text or "").strip():
            errors.append(f"Item #{idx} <guid> is required and cannot be empty")

        enclosure = item.find("enclosure")
        if enclosure is None:
            errors.append(f"Item #{idx} <enclosure> is required")
        else:
            url = enclosure.attrib.get("url", "").strip()
            if not url:
                errors.append(f"Item #{idx} <enclosure> 'url' attribute is required")

            length = enclosure.attrib.get("length", "").strip()
            if not length or not length.isdigit() or int(length) < 0:
                errors.append(
                    f"Item #{idx} <enclosure> 'length' attribute must be a non-negative integer, got '{length}'"
                )

            enc_type = enclosure.attrib.get("type", "").strip()
            if not enc_type:
                errors.append(f"Item #{idx} <enclosure> 'type' attribute is required (e.g. audio/mpeg)")

        pub_date = item.findtext("pubDate")
        if not pub_date or not pub_date.strip():
            errors.append(f"Item #{idx} <pubDate> is required")
        else:
            try:
                parsed_date = email.utils.parsedate_to_datetime(pub_date.strip())
                if parsed_date is None:
                    errors.append(f"Item #{idx} <pubDate> '{pub_date}' is not a valid RFC 2822 date")
            except (ValueError, TypeError, IndexError) as exc:
                errors.append(f"Item #{idx} <pubDate> '{pub_date}' cannot be parsed as RFC 2822: {exc}")

        duration = item.findtext("itunes:duration", namespaces=NAMESPACES)
        if duration and not DURATION_REGEX.match(duration.strip()):
            errors.append(
                f"Item #{idx} <itunes:duration> '{duration}' is not a valid duration format (HH:MM:SS or seconds)"
            )
