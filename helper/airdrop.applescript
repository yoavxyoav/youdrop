-- Sends a URL to the macOS AirDrop picker via the documented AppKit sharing API.
-- Usage: osascript airdrop.applescript <url> [holdSeconds] [heartbeatPath]
--
-- Why this instead of UI-scripting Safari's Share menu: Safari's share popover exposes
-- its destinations as unlabelled AXButtons (no name, no help, no value), so picking
-- "AirDrop" would mean clicking a hard-coded index. NSSharingService is public API and
-- survives OS updates. It also needs no Accessibility permission.

use framework "AppKit"
use framework "Foundation"
use scripting additions

on run argv
	if (count of argv) < 1 then error "no URL argument"
	set urlText to item 1 of argv

	set holdSeconds to 120
	if (count of argv) > 1 then
		try
			set holdSeconds to (item 2 of argv) as integer
		end try
	end if

	set heartbeatPath to ""
	if (count of argv) > 2 then set heartbeatPath to item 3 of argv

	set svc to current application's NSSharingService's sharingServiceNamed:(current application's NSSharingServiceNameSendViaAirDrop)
	if svc is missing value then error "AirDrop sharing service unavailable"

	-- Must be an NSURL. canPerformWithItems: returns false for a plain NSString.
	set theURL to current application's NSURL's URLWithString:urlText
	if theURL is missing value then error "could not parse URL: " & urlText

	if not ((svc's canPerformWithItems:{theURL}) as boolean) then
		error "AirDrop cannot handle this item"
	end if

	-- osascript is not a GUI app by default. Without an NSApplication and an activation
	-- policy, the picker cannot take focus properly. Policy 1 is
	-- NSApplicationActivationPolicyAccessory: real UI, no Dock icon.
	set theApp to current application's NSApplication's sharedApplication()
	theApp's setActivationPolicy:1
	theApp's activateIgnoringOtherApps:true

	svc's performWithItems:{theURL}

	-- THE IMPORTANT BIT. The picker is presented by THIS process, so the process must
	-- stay alive AND keep pumping its run loop. A plain `delay` blocks the main thread:
	-- the picker draws, but the click that selects a recipient can never be dispatched,
	-- so the window vanishes the moment you click it. runUntilDate: keeps the run loop
	-- turning, which is what makes the picker actually interactive.
	set deadline to (current application's NSDate's dateWithTimeIntervalSinceNow:holdSeconds)
	set theLoop to current application's NSRunLoop's mainRunLoop()
	set ticks to 0

	repeat
		if ((deadline's timeIntervalSinceNow()) as real) ≤ 0 then exit repeat
		theLoop's runUntilDate:(current application's NSDate's dateWithTimeIntervalSinceNow:0.15)
		set ticks to ticks + 1

		-- Optional: proves the run loop is actually turning, for debugging.
		if heartbeatPath is not "" then
			set hb to current application's NSString's stringWithString:((ticks as text) & linefeed)
			hb's writeToFile:heartbeatPath atomically:true encoding:(current application's NSUTF8StringEncoding) |error|:(missing value)
		end if
	end repeat

	return "held " & (ticks as text) & " ticks"
end run
