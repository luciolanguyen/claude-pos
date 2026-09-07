import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PostCSS chạy với thư mục làm việc là gốc dự án, nên phải chỉ rõ
// đường dẫn tới tailwind.config.js của thư mục client.
const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.join(dir, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
