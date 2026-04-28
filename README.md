# pi-codex-fast

Fast Mode extension for [pi](https://pi.dev) that toggles OpenAI/Codex priority service tier for configured models.

## Install

```bash
pi install npm:pi-codex-fast
```

Try it temporarily without installing:

```bash
pi -e npm:pi-codex-fast
```

Or test from a local checkout:

```bash
pi -e ./
```

## Usage

The extension adds the `/fast` command:

```text
/fast          Toggle Fast Mode on/off
/fast on       Enable Fast Mode
/fast off      Disable Fast Mode
/fast toggle   Toggle Fast Mode on/off
/fast status   Show current status
/fast style    Cycle the footer status style
```

When enabled, requests for configured OpenAI/OpenAI Codex models use `serviceTier: "priority"`.

## How it works

`pi-codex-fast` registers provider wrappers for pi's OpenAI Responses and OpenAI Codex Responses APIs.

For configured models, the wrapper calls the native provider streamer with `serviceTier: "priority"`. For all other models, providers, or disabled Fast Mode, it falls through to pi's normal simple streamers unchanged.

The extension intentionally does **not** use the `before_provider_request` hook to patch request payloads. That preserves pi's native provider flow, including pi's built-in usage and cost calculation.

## Configuration

On first load, the extension creates:

```text
~/.pi/agent/extensions/pi-codex-fast.json
```

If `PI_CODING_AGENT_DIR` is set, the config is created under that agent directory instead.

Default config:

```json
{
  "enabled": false,
  "models": ["openai/gpt-5.4", "openai/gpt-5.5", "openai-codex/gpt-5.4", "openai-codex/gpt-5.5"]
}
```

Optional fields such as `style` are resolved internally and only written when changed via `/fast style`.

Model entries may be provider-qualified, for example `openai/gpt-5.5`, or bare model IDs, for example `gpt-5.5`.

## License

MIT
