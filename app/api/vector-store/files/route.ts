import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function GET() {
  try {
    const files = await openai.files.list();
    
    const filesList = files.data
      .filter(file => file.purpose === 'assistants')
      .map(file => ({
        fileName: file.filename,
        uploadDate: file.created_at,
        fileId: file.id
      }));
    
    return NextResponse.json(filesList);
  } catch (error) {
    console.error('获取文件列表失败:', error);
    return NextResponse.json(
      { error: '获取文件列表失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 