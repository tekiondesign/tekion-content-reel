figma.showUI(__html__, { width: 380, height: 580 });

// ── Utility: load fonts safely (handles mixed fonts) ──
async function loadFonts(node) {
	try {
		await figma.loadFontAsync(node.fontName);
	} catch (e) {
		const len = node.characters.length || 1;
		for (let c = 0; c < len; c++) {
			await figma.loadFontAsync(node.getRangeFontName(c, c + 1));
		}
	}
}

// ── Utility: Fisher-Yates shuffle ──
function shuffle(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// ── Utility: check if node supports image fills ──
function canHaveImageFill(node) {
	return "fills" in node && node.type !== "TEXT" && node.type !== "GROUP";
}

figma.ui.onmessage = async (msg) => {
	// ── Apply shuffled texts ──
	if (msg.type === "apply-random-text") {
		const sel = figma.currentPage.selection;
		const textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select one or more text layers first.");
			return;
		}
		const pool = shuffle(msg.values);
		let applied = 0;
		for (let i = 0; i < textNodes.length; i++) {
			await loadFonts(textNodes[i]);
			textNodes[i].characters = pool[i % pool.length];
			applied++;
		}
		figma.notify(`✓ Applied random text to ${applied} layer(s)`);
	}

	// ── Apply single text ──
	if (msg.type === "apply-single-text") {
		const sel = figma.currentPage.selection;
		const textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select a text layer first.");
			return;
		}
		for (const node of textNodes) {
			await loadFonts(node);
			node.characters = msg.value;
		}
		figma.notify(`✓ Applied to ${textNodes.length} layer(s)`);
	}

	// ── Apply avatar image from bytes sent by UI ──
	if (msg.type === "apply-avatar-bytes") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select a shape, frame, or auto-layout layer.");
			return;
		}
		const fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify(
				"⚠ No fillable layers. Select rectangles, ellipses, frames, etc.",
			);
			return;
		}

		try {
			const bytes = new Uint8Array(msg.bytes);
			const image = figma.createImage(bytes);
			let applied = 0;
			for (const node of fillable) {
				node.fills = [
					{
						type: "IMAGE",
						scaleMode: "FILL",
						imageHash: image.hash,
					},
				];
				applied++;
			}
			figma.notify(`✓ Applied avatar to ${applied} layer(s)`);
		} catch (e) {
			console.error("Avatar apply error:", e);
			figma.notify("⚠ Failed to apply avatar image.");
		}
	}

	// ── Shuffle random avatars (bytes array from UI) ──
	if (msg.type === "apply-random-avatar-bytes") {
		const sel = figma.currentPage.selection;
		const fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify("⚠ Select shapes or frames for avatar fills.");
			return;
		}

		const allBytes = msg.bytesArray; // array of Uint8Array-compatible arrays
		let applied = 0;
		for (let i = 0; i < fillable.length; i++) {
			const imgData = allBytes[i % allBytes.length];
			if (!imgData) continue;
			try {
				const image = figma.createImage(new Uint8Array(imgData));
				fillable[i].fills = [
					{
						type: "IMAGE",
						scaleMode: "FILL",
						imageHash: image.hash,
					},
				];
				applied++;
			} catch (e) {
				console.error("Failed to apply avatar:", e);
			}
		}
		figma.notify(`✓ Applied ${applied} avatar(s) to selection`);
	}

	// ── Fallback: try figma.createImageAsync if UI fetch failed ──
	if (msg.type === "apply-avatar-fallback") {
		const sel = figma.currentPage.selection;
		const fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify("⚠ No fillable layers selected.");
			return;
		}
		try {
			const image = await figma.createImageAsync(msg.url);
			for (const node of fillable) {
				node.fills = [
					{
						type: "IMAGE",
						scaleMode: "FILL",
						imageHash: image.hash,
					},
				];
			}
			figma.notify(`✓ Applied avatar to ${fillable.length} layer(s)`);
		} catch (e) {
			console.error("Fallback also failed:", e);
			figma.notify(
				"⚠ Could not load image. Check URL and network permissions.",
			);
		}
	}

	// ── Apply SVG icon ──
	if (msg.type === "apply-icon") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select one or more frames or shapes.");
			return;
		}
		let iconNode;
		try {
			iconNode = figma.createNodeFromSvg(msg.svg);
		} catch (e) {
			figma.notify("⚠ Failed to parse icon SVG.");
			return;
		}
		let applied = 0;
		for (const node of sel) {
			if ("appendChild" in node) {
				const clone = iconNode.clone();
				const scale =
					Math.min(node.width / clone.width, node.height / clone.height) * 0.55;
				clone.rescale(scale);
				clone.x = (node.width - clone.width) / 2;
				clone.y = (node.height - clone.height) / 2;
				node.appendChild(clone);
				applied++;
			}
		}
		iconNode.remove();
		figma.notify(
			applied
				? `✓ Placed icon in ${applied} layer(s)`
				: "⚠ Select frames or components.",
		);
	}
};
