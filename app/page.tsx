"use client";

import { useState, useEffect } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import "./../app/app.css";
import { Amplify } from "aws-amplify";
import outputs from "@/amplify_outputs.json";
import "@aws-amplify/ui-react/styles.css";
import Chat from "./chat/Chat";

Amplify.configure(outputs);

const client = generateClient<Schema>();

export default function App() {
  const [todos, setTodos] = useState<Array<Schema["Todo"]["type"]>>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const { user, signOut } = useAuthenticator();

  function listTodos() {
    client.models.Todo.observeQuery().subscribe({
      next: (data) => setTodos([...data.items]),
    });
  }

  useEffect(() => {
    listTodos();
  }, []);

  useEffect(() => {
    // 假设 user.username 是用户 ID
    if (user) {
      setUserId(user.username);
    }
  }, [user]);

  function createTodo() {
    client.models.Todo.create({
      content: window.prompt("Todo content"),
    });
  }

  function deleteTodo(id: string) {
    client.models.Todo.delete({ id });
  }

  return (
    <main>
      <div>
        <h1>Welcome to the Chat App</h1>
        {userId ? <Chat userId={userId} /> : <p>Loading...</p>}
      </div>
      <div style={{ height: '20px' }}></div> {/* 空隙 */}
      <button onClick={signOut}>Sign out</button>
    </main>
  );
}