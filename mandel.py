import numpy as np
import matplotlib.pyplot as plt
from tqdm import tqdm

def compute_mandel(xmin, xmax, ymin, ymax, width=800, height=600, max_iter=500):
    x = np.linspace(xmin, xmax, width)
    y = np.linspace(ymin, ymax, height)
    X, Y = np.meshgrid(x, y)
    C = X + 1j * Y

    z = np.zeros_like(C, dtype=np.complex128)
    iters = np.zeros(C.shape, dtype=float)
    mask = np.ones(C.shape, dtype=bool)

    for i in tqdm(range(max_iter), desc="Mandelbrot iteriert", leave=False):
        z[mask] = z[mask]**2 + C[mask]
        escaped = np.abs(z) > 2
        # smooth coloring für neue Escapes
        new_esc = mask & escaped
        if np.any(new_esc):
            nu = i + 1 - np.log2(np.log2(np.abs(z[new_esc])))
            iters[new_esc] = nu
        mask &= ~escaped
        if not mask.any():
            break

    # Punkte, die nie escapen, auf 0
    iters[mask] = 0
    return iters

# Startbereich: volles Männchen
extent = [-2.0, 0.47, -1.12, 1.12]
xmin, xmax, ymin, ymax = extent

fig, ax = plt.subplots(figsize=(10, 8))

def redraw(ax):
    global img
    xmin, xmax = ax.get_xlim()
    ymin, ymax = ax.get_ylim()

    xmin, xmax = sorted([xmin, xmax])
    ymin, ymax = sorted([ymin, ymax])

    iters = compute_mandel(xmin, xmax, ymin, ymax,
                           width=1000, height=800, max_iter=600)
    img.set_data(iters)
    img.set_extent([xmin, xmax, ymin, ymax])
    fig.canvas.draw_idle()

# initiales Bild
iters0 = compute_mandel(xmin, xmax, ymin, ymax,
                        width=1000, height=800, max_iter=400)
img = ax.imshow(
    iters0,
    extent=extent,
    origin="lower",
    cmap="nipy_spectral",      # mehr Neon
    interpolation="bilinear"   # weniger Pixelblöcke
)
ax.set_xlabel("Re(c)")
ax.set_ylabel("Im(c)")
ax.set_title("Mandelbrot – Zoom mit Neuberechnung (Neon)")
fig.colorbar(img, ax=ax, label="Iterationen")

def on_release(event):
    if event.inaxes != ax:
        return
    redraw(ax)

fig.canvas.mpl_connect('button_release_event', on_release)

plt.show()
