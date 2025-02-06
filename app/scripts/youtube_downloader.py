from yt_dlp import YoutubeDL
import sys
import json
import os

def download_audio(url, output_path):
    print(f"开始下载: {url}", file=sys.stderr)
    print(f"输出路径: {output_path}", file=sys.stderr)
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': output_path,
        'quiet': False,  # 显示下载进度
        'no_warnings': False  # 显示警告信息
    }
    
    try:
        print(f"当前工作目录: {os.getcwd()}", file=sys.stderr)
        with YoutubeDL(ydl_opts) as ydl:
            print("开始下载...", file=sys.stderr)
            ydl.download([url])
            print("下载完成", file=sys.stderr)
        return {'success': True, 'output_path': output_path}
    except Exception as e:
        print(f"下载失败: {str(e)}", file=sys.stderr)
        return {'success': False, 'error': str(e)}

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({
            'success': False,
            'error': f'参数不足. 需要 URL 和输出路径. 收到的参数: {sys.argv}'
        }))
        sys.exit(1)
        
    url = sys.argv[1]
    output_path = sys.argv[2]
    result = download_audio(url, output_path)
    print(json.dumps(result)) 