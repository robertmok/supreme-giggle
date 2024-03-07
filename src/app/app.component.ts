import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import * as signalR from '@microsoft/signalr';

interface User {
  ConnectionId: string;
  Name: string | null;
}

interface Group {
  Members: User[];
  Name: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  @ViewChild("privateUser") userSelect!: ElementRef; 
  messageHistory = [
    {
      name: 'CChat',
      connectionId: '',
      message: 'Welcome to CChat!',
    },
  ];
  privateHistory: any[] = [];
  groupsHistory: any[] = [];
  groupsList: Group[] = [];
  groupJoined = ''; 
  usersList: User[] = [];
  userConnectionId: string | null = '';
  serverMessage = '';
  connection = new signalR.HubConnectionBuilder()
    .withUrl('https://localhost:44368/hub')
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();
  aiConnection = new signalR.HubConnectionBuilder()
    .withUrl('https://localhost:7202/hub')
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();
  aiHistory: any[] = [];
  llmModels = ["gemma:2b", "orca-mini:3b", "llama2"];
  aiMessageBuffer = "";
  loading = false;

  ngOnInit() {
    //this.startConnection();
    this.startAiConnection();

    this.connection.onreconnected((connectionId) => {
      console.assert(
        this.connection.state === signalR.HubConnectionState.Connected
      );
      console.log(
        `Connection reestablished. Connected with connectionId "${connectionId}".`
      );
      this.serverMessage = `Connection reestablished. Connected with connectionId "${connectionId}".`;
    });

    this.connection.onclose((error) => {
      console.assert(
        this.connection.state === signalR.HubConnectionState.Disconnected
      );
      console.log(
        `Connection closed due to error "${error}". Try refreshing this page to restart the connection.`
      );
      this.serverMessage = `Connection closed due to error "${error}". Try refreshing this page to restart the connection.`;
    });

    this.connection.on('ReceiveConnectedUsers', (users: string) => {
      this.usersList = JSON.parse(users);
    });

    this.connection.on(
      'ReceiveMessage',
      (username: string, connectionId: string, message: string) => {
        this.messageHistory.push({
          name: username,
          connectionId: connectionId, 
          message: message
        });
      }
    );

    this.connection.on(
      'ReceivePrivateMessage',
      (response: string) => {
        let responseData = JSON.parse(response);
        this.userSelect.nativeElement.value = responseData.SenderConnectionId;
        let receiverName = this.usersList.filter(user => user.ConnectionId === responseData.SenderConnectionId)[0].Name;
        
        this.privateHistory.push({
          name: receiverName ?? 'Unkown User (' + responseData.SenderConnectionId + ')',
          connectionId: responseData.SenderConnectionId,
          message: responseData.Message,
        });
      }
    );

    this.connection.on('ReceiveGroups', (groups: string) => {
      this.groupsList = JSON.parse(groups);
    });

    this.aiConnection.on('ReceiveAiMessage', (message: any) => {
      console.log(message);
      if (message) {
        this.loading = false;
      }
      if (message && message.done === false)
      {
        this.aiMessageBuffer += message.message.content;
      }
      else if (message && message.done === true)
      {
        this.aiHistory.push({
          role: "assistant",
          content: this.aiMessageBuffer
        });
        this.aiMessageBuffer = ""; //reset
      }
    });
  }

  async startConnection() {
    try {
      await this.connection.start();
      console.log('SignalR Connected.');
      this.serverMessage = 'SignalR Connected.';
      console.log('connection Id: ' + this.connection.connectionId);
      this.userConnectionId = this.connection.connectionId;
      this.getGroups();
    } catch (err) {
      console.log(err);
      this.serverMessage = JSON.stringify(err);
      setTimeout(this.startConnection, 5000);
    }
  }

  async startAiConnection() {
    try {
      await this.aiConnection.start();
      console.log('SignalR Connected.');
    } catch (err) {
      console.log(err);
      setTimeout(this.startAiConnection, 5000);
    }
  }

  async saveUsername(name: string) {
    try {
      await this.connection.invoke('SaveUsername', name);
    } catch (err) {
      console.log(err);
      this.serverMessage = JSON.stringify(err);
    }
  }

  async sendToAll(user: string, message: string) {
    try {
      await this.connection.invoke('SendMessageToAll', user, message);
    } catch (err) {
      console.error(err);
      this.serverMessage = JSON.stringify(err);
    }
  }

  async sendPrivateMessage(receiverConnectionId: string, message: string) {
    if (receiverConnectionId !== '' && message !== '') {
      try {
        await this.connection.invoke(
          'SendPrivateMessage', 
          this.userConnectionId, 
          receiverConnectionId, 
          message
        );

        let user = this.usersList.filter(user => user.ConnectionId === this.userConnectionId)[0].Name;
        this.privateHistory.push({
          name: user ?? 'You (' + this.userConnectionId + ')',
          connectionId: this.userConnectionId,
          message: message,
        });
      } catch (err) {
        console.error(err);
        this.serverMessage = JSON.stringify(err);
      }
    }
  }

  filteredUsers() {
    return this.usersList.filter(user => user.ConnectionId !== this.userConnectionId);
  }

  addListenOnGroup(groupName: string) {
    this.connection.on(
      groupName,
      (userConnectionId: string, message: string) => {
        let userDetails = this.usersList.find(user => user.ConnectionId === userConnectionId);
        let user = '';
        if (userDetails) {
          user = userDetails.Name 
                  ? userDetails.Name
                  : (userDetails.ConnectionId === this.userConnectionId ? 'You' : 'Unknown User');
          user += ' (' + userConnectionId + ')';
        }
        
        let index = this.groupsHistory.findIndex((group) => group.group === groupName);
        if (index === -1) {
          this.groupsHistory.push({
            group: groupName,
            history: [{
              name: user,
              message: message
            }]
          });
        } else {
          this.groupsHistory[index].history.push({
            name: user,
            message: message
          });
        }
      }
    );
  }

  async joinGroupChat(groupName: string) {
    if (groupName !== '' && groupName !== this.groupJoined) {
      try {
        if (this.groupJoined) {
          await this.leaveGroup(this.groupJoined);
        }
        this.addListenOnGroup(groupName);
        await this.connection.invoke('AddToGroup', groupName, this.userConnectionId);
        this.groupJoined = groupName;
      } catch (err) {
        console.error(err);
        this.serverMessage = JSON.stringify(err);
      }
    }
  }

  async leaveGroup(groupName: string) {
    try {
      await this.connection.invoke('RemoveFromGroup', groupName, this.userConnectionId);
      this.removeListenOnGroup(groupName);

      //clear group chat history
      let index = this.groupsHistory.findIndex((group) => group.group === groupName);
      if (index !== -1) {
        this.groupsHistory[index].history = [];
      }
    } catch (err) {
      console.error(err);
      this.serverMessage = JSON.stringify(err);
    }
  }

  removeListenOnGroup(groupName: string) {
    this.connection.off(groupName);
  }

  async getGroups() {
    try {
      await this.connection.invoke('GetGroups');
    } catch (err) {
      console.error(err);
      this.serverMessage = JSON.stringify(err);
    }
  }

  groupMembers(groupName: string): User[] {
    let index = this.groupsList.findIndex(group => group.Name === groupName);
    if (index !== -1) {
      return this.groupsList[index].Members;
    }
    return [];
  }

  getGroupHistory() {
    let index = this.groupsHistory.findIndex(group => group.group === this.groupJoined);
    if (index !== -1) {
      return this.groupsHistory[index].history;
    }
    return [];
  }

  async sendGroupMessage(message: string) {
    try {
      await this.connection.invoke(
        'SendMessageToGroup',
        this.userConnectionId, 
        message,
        this.groupJoined
      );
    } catch (err) {
      console.error(err);
      this.serverMessage = JSON.stringify(err);
    }
  }

  async sendToAI(message: string, model: string) {
    if (this.loading === false) {
      try {
        this.loading = true;
        let llmModel = model !== '' ? model : null;
        this.aiHistory.push(
          {
            role: "user",
            content: message
          }
        );
        await this.aiConnection.invoke('SendAiMessage', this.aiHistory, llmModel);
      } catch (err) {
        console.error(err);
      }
    }
  }
}
